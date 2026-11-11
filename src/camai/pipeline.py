"""Glue: footage -> motion gate -> Haiku description -> stored events."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from camai.describe import describe_event
from camai.gate import GateConfig, detect
from camai.ingest import FileSource
from camai.llm import Claude
from camai.site import Camera, Site
from camai.store import Store

GATE_FPS = 4.0


def process_camera(
    site: Site,
    cam: Camera,
    claude: Claude | None,
    store: Store,
    media_root: Path,
    log: Callable[[str], None] = print,
) -> list[int]:
    src = FileSource(cam.file)
    cfg = GateConfig(masks=cam.masks)
    events = detect(src.iter_gray(fps=GATE_FPS), GATE_FPS, cfg)
    log(f"[{cam.id}] {cam.file.name}: {src.info.duration:.0f}s of footage -> {len(events)} gate events")
    ids = []
    for ev in events:
        ts = cam.at(ev.start_s)
        rel = Path(site.id) / cam.id / f"{ts:%Y%m%d_%H%M%S}_{ev.kind}"
        media_dir = media_root / rel
        media: dict = {"dir": str(rel)}
        report = llm = None
        # Whole-frame changes of 2 s or more (someone close to a door camera, a light being
        # switched on) also get an AI look; short flashes (headlight sweeps, IR switching) do not.
        describe = ev.kind == "motion" or (ev.kind == "global_change" and ev.duration_s >= 2.0)
        if describe:
            media["clip"] = src.cut(ev.start_s, ev.end_s, media_dir / "clip.mp4").name
            if claude is not None:
                report, res, paths = describe_event(claude, src, ev, cam.start, media_dir, blackout=cam.masks)
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
                log(
                    f"  {cam.at(ev.start_s):%H:%M:%S} {ev.duration_s:5.1f}s  "
                    f"{report['activity']:<18} {report['summary'][:90]}"
                    f"{'  (cached)' if res.cached else ''}"
                )
        else:
            media["still"] = src.grab(ev.start_s + 0.5, media_dir / "still.jpg", max_width=768).name
            log(f"  {cam.at(ev.start_s):%H:%M:%S} {ev.kind}")
        ids.append(
            store.upsert_event(
                site_id=site.id,
                camera_id=cam.id,
                kind=ev.kind,
                start_s=round(ev.start_s, 2),
                end_s=round(ev.end_s, 2),
                peak_s=round(ev.peak_s, 2),
                bbox=list(ev.bbox),
                ts=ts,
                media=media,
                report=report,
                llm=llm,
            )
        )
    return ids


def process_site(site: Site, claude: Claude | None, store: Store, media_root: Path, log=print) -> None:
    for cam in site.cameras:
        process_camera(site, cam, claude, store, media_root, log)
