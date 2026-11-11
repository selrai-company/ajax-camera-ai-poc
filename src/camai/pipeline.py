"""Glue: recordings -> motion gate -> Haiku descriptions -> stored events, then the
site-level analysis (lock-up checks, alarm verification, incidents)."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

from camai.describe import describe_event
from camai.gate import Event, GateConfig, detect
from camai.ingest import FileSource
from camai.llm import Claude
from camai.site import Camera, Recording, Site
from camai.store import Store

GATE_FPS = 4.0
WORKERS = 4  # parallel AI descriptions


def _poster(src: FileSource, out: Path) -> str:
    if not out.exists():
        src.grab(min(1.0, src.info.duration / 2), out, max_width=960)
    return out.name


def wall_copy(src: FileSource, out: Path) -> str:
    """A light, browser-friendly copy of the whole recording for the camera wall tiles."""
    if not out.exists():
        import subprocess

        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src.path), "-vf", "scale='min(854,iw)':-2,fps=15",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             "-an", str(out)],
            check=True,
        )
    return out.name


def _job(site: Site, cam: Camera, rec: Recording, src: FileSource, ev: Event, media_root: Path) -> dict:
    ts = rec.start + timedelta(seconds=ev.start_s)
    end = rec.start + timedelta(seconds=ev.end_s)
    rel = Path(site.id) / cam.id / f"{ts:%Y%m%d_%H%M%S}_{ev.kind}"
    return dict(cam=cam, rec=rec, src=src, ev=ev, ts=ts, end=end, rel=rel, media_dir=media_root / rel)


def process_camera(
    site: Site,
    cam: Camera,
    claude: Claude | None,
    store: Store,
    media_root: Path,
    log: Callable[[str], None] = print,
) -> list[int]:
    jobs = []
    for rec in cam.recordings:
        src = FileSource(rec.file)
        _poster(src, media_root / site.id / cam.id / f"poster_{rec.start:%Y%m%d_%H%M%S}.jpg")
        wall_copy(src, media_root / site.id / cam.id / f"wall_{rec.start:%Y%m%d_%H%M%S}.mp4")
        events = detect(src.iter_gray(fps=GATE_FPS), GATE_FPS, GateConfig(masks=cam.masks))
        log(f"[{cam.id}] {rec.file.name} @ {rec.start:%H:%M}: {src.info.duration:.0f}s -> {len(events)} gate events")
        # Whole-frame blips under 1.5 s (exposure steps, headlight flashes) aren't worth storing.
        events = [ev for ev in events if not (ev.kind == "global_change" and ev.duration_s < 1.5)]
        jobs += [_job(site, cam, rec, src, ev, media_root) for ev in events]

    def run(j: dict) -> dict:
        ev, src, media_dir = j["ev"], j["src"], j["media_dir"]
        media: dict = {"dir": str(j["rel"])}
        report = llm = None
        # Whole-frame changes of 2 s or more (someone close to a door camera, a light being
        # switched on) also get an AI look; short flashes (headlight sweeps, IR switching) do not.
        describe = ev.kind == "motion" or (ev.kind == "global_change" and ev.duration_s >= 2.0)
        if describe:
            media["clip"] = src.cut(ev.start_s, ev.end_s, media_dir / "clip.mp4").name
            if claude is not None:
                report, res, paths = describe_event(claude, src, ev, j["rec"].start, media_dir, blackout=cam.masks)
                media.update(paths)
                llm = {
                    "model": res.model,
                    "backend": res.backend,
                    "input_tokens": res.input_tokens,
                    "output_tokens": res.output_tokens,
                    "est_api_cost_usd": round(res.est_api_cost_usd, 6),
                    "latency_ms": res.latency_ms,
                    "cached": res.cached,
                }
                frames = paths["frames"]
                ef = [i for i in report.get("evidence_frames", []) if 1 <= i <= len(frames)]
                media["key_frame"] = frames[ef[0] - 1] if ef else frames[len(frames) // 2]
                log(
                    f"  {j['ts']:%H:%M:%S} {ev.duration_s:5.1f}s  {report['activity']:<18} "
                    f"{report['summary'][:84]}{'  (cached)' if res.cached else ''}"
                )
        else:
            media["still"] = src.grab(ev.start_s + 0.5, media_dir / "still.jpg", max_width=768).name
            media["key_frame"] = media["still"]
            log(f"  {j['ts']:%H:%M:%S} {ev.kind}")
        return dict(j, media=media, report=report, llm=llm)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        done = list(pool.map(run, jobs))

    ids = []
    for d in sorted(done, key=lambda d: d["ts"]):
        ev = d["ev"]
        ids.append(
            store.upsert_event(
                site_id=site.id,
                camera_id=cam.id,
                kind=ev.kind,
                start_s=round(ev.start_s, 2),
                end_s=round(ev.end_s, 2),
                peak_s=round(ev.peak_s, 2),
                bbox=list(ev.bbox),
                ts=d["ts"],
                end_ts=d["end"],
                media=d["media"],
                report=d["report"],
                llm=d["llm"],
            )
        )
    return ids


def process_site(site: Site, claude: Claude | None, store: Store, media_root: Path, log=print) -> None:
    for cam in site.cameras:
        process_camera(site, cam, claude, store, media_root, log)
    if claude is not None:
        from camai.analysis import analyse_site

        analyse_site(site, store, claude, media_root, log)
