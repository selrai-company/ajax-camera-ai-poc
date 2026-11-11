"""Site-level analysis after events are described:

- lock-up and perimeter checks (a frame at lock-up time, a yes/no question per camera)
- asset checks ("is the excavator in the compound?" at lock-up and again in the morning)
- incidents: armed needs-a-look / unconfirmed events close together, grouped across cameras,
  with a one-sentence AI headline
- alarm verification: each (simulated) Ajax alarm is matched to footage on its camera
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pathlib import Path

from camai.checks import HaikuChecker
from camai.describe import describe_event
from camai.gate import Event
from camai.ingest import FileSource
from camai.llm import SONNET, Claude, Image, LLMError
from camai.rules import NEEDS_LOOK, RANK, UNCONFIRMED, activity_label, evaluate
from camai.site import Camera, Site, night_of, night_window
from camai.store import Store

INCIDENT_GAP = timedelta(minutes=5)
CAMERA_DOWN_WINDOW = timedelta(minutes=2)

HEADLINE_SCHEMA = {
    "type": "object",
    "properties": {"headline": {"type": "string"}},
    "required": ["headline"],
    "additionalProperties": False,
}

HEADLINE_SYSTEM = """You write the one-sentence headline for a security incident on a job site, from camera event reports.
- At most 22 words, plain English, Australian spelling, calm and factual. Include the time (e.g. 2:14am).
- Say what was seen and where (camera names). If events are on several cameras, describe them as happening in the same time window; never claim it was the same person or vehicle.
- Camera names say where something was seen; they are not objects in the scene (write "on the Car park camera", never "at the Car park camera").
- Lead with the most serious event (forcing a gate or lock, loading or towing something, covering a camera) rather than the first one.
- Never identify anyone, guess intent, or call anything a crime. Don't add facts that aren't in the reports."""


def nights_for(site: Site, store: Store) -> list[date]:
    nights = {night_of(e["ts"]) for e in store.events(site.id)}
    nights |= {night_of(r.start) for c in site.cameras for r in c.recordings}
    return sorted(nights)


def frame_at(cam: Camera, ts: datetime, out: Path, blackout=()) -> Path | None:
    """Grab the camera's frame at wall-clock time ts, if a recording covers it."""
    for rec in cam.recordings:
        src = FileSource(rec.file)
        offset = (ts - rec.start).total_seconds()
        if 0 <= offset <= src.info.duration:
            return src.grab(offset, out, max_width=960, blackout=blackout or cam.masks)
    return None


def _ask(claude: Claude, question: str, image: Path) -> tuple[str, str]:
    # A handful of calls a night, and a wrong "all locked up" is costly: use Sonnet for these.
    r = HaikuChecker(claude, model=SONNET).check(question, ["yes", "no"], [Image.from_path(image)])
    return r.answer, r.raw.get("why", "")


def run_checks(site: Site, store: Store, claude: Claude, night: date, media_root: Path, log=print) -> None:
    def at(t) -> datetime:
        d = datetime.combine(night, t)
        return d if t.hour >= 12 else d + timedelta(days=1)

    if site.lockup_at:
        ts = at(site.lockup_at)
        for chk in site.lockup_checks:
            cam = site.camera(chk.camera_id)
            img = frame_at(cam, ts, media_root / site.id / cam.id / f"lockup_{night}_{abs(hash(chk.question)) % 10**6}.jpg")
            if img is None:
                answer, why = "cant_tell", "No recording at lock-up time"
            else:
                answer, why = _ask(claude, chk.question, img)
            store.save_lockup(site.id, str(night), camera_id=cam.id, question=chk.question, phase=chk.kind,
                              answer=answer, ok=answer == chk.expect, at=ts,
                              image=f"{site.id}/{cam.id}/{img.name}" if img else None, why=why)
            log(f"  lock-up {cam.name}: {chk.question} -> {answer}")

    morning = site.morning_at or site.armed_to
    for asset in site.assets:
        cam = site.camera(asset.camera_id)
        for phase, t in (("asset_evening", site.lockup_at), ("asset_morning", morning)):
            if t is None:
                continue
            ts = at(t)
            img = frame_at(cam, ts, media_root / site.id / cam.id / f"{phase}_{night}.jpg")
            if img is None:
                continue
            answer, why = _ask(claude, asset.question, img)
            store.save_lockup(site.id, str(night), camera_id=cam.id, question=asset.question, phase=phase,
                              label=asset.asset, answer=answer, ok=answer == "yes", at=ts,
                              image=f"{site.id}/{cam.id}/{img.name}", why=why)
            log(f"  asset {asset.asset} ({phase}): {answer}")


def _recording_for(cam: Camera, ts: datetime):
    for rec in cam.recordings:
        dur = FileSource(rec.file).info.duration
        if rec.start <= ts <= rec.start + timedelta(seconds=dur + 1):
            return rec
    return None


def escalate(site: Site, store: Store, claude: Claude, e: dict, media_root: Path, log=print) -> bool:
    """Second, deeper look with Sonnet 5.5: more frames, higher resolution. Replaces the Haiku report."""
    if (e.get("llm") or {}).get("model") == SONNET or not site.has_camera(e["camera_id"]):
        return False
    cam = site.camera(e["camera_id"])
    rec = _recording_for(cam, e["ts"])
    if rec is None:
        return False
    src = FileSource(rec.file)
    m = e["media"] or {}
    ev = Event(e["start_s"], e["end_s"], tuple(e["bbox"]), e["kind"], e["peak_s"], 0.0, None,
               [(p["t"] + e["start_s"], tuple(p["box"])) for p in m.get("track", [])])
    n = max(8, min(14, round(ev.duration_s / 2.5)))
    try:
        report, res, paths = describe_event(claude, src, ev, rec.start, media_root / m["dir"], n_frames=n, model=SONNET,
                                            blackout=cam.masks, width=1024, prefix="s_", effort="medium", zoom=True)
    except LLMError as err:
        log(f"  escalation failed for event {e['id']}: {err}")
        return False
    frames = paths["frames"]
    ef = [i for i in report.get("evidence_frames", []) if 1 <= i <= len(frames)]
    media = {**m, **paths, "key_frame": frames[ef[0] - 1] if ef else frames[len(frames) // 2], "haiku_frames": m.get("frames")}
    llm = {"model": res.model, "backend": res.backend, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
           "est_api_cost_usd": round(res.est_api_cost_usd + (e.get("llm") or {}).get("est_api_cost_usd", 0), 6),
           "latency_ms": res.latency_ms, "cached": res.cached, "escalated_from": (e.get("llm") or {}).get("model")}
    store.upsert_event(site_id=site.id, camera_id=e["camera_id"], kind=e["kind"], start_s=e["start_s"], end_s=e["end_s"],
                       peak_s=e["peak_s"], bbox=e["bbox"], ts=e["ts"], end_ts=e["end_ts"], media=media, report=report, llm=llm)
    log(f"  escalated {e['ts']:%H:%M:%S} {cam.name}: {report.get('activity')} | {report.get('title')}")
    return True


def _flagged(site: Site, store: Store, night: date) -> list[tuple[dict, object]]:
    """Events that belong in an incident: needs-a-look / unconfirmed, camera-down events, and anything another
    camera saw within 2 minutes of a camera going blank (possible tampering)."""
    start, end = night_window(night)
    rules = store.rules(site.id)
    events = [e for e in store.events(site.id, start, end) if not e["dismissed"] and site.has_camera(e["camera_id"])]
    blanks = [e for e in events if e["kind"] == "blank_view"]
    out = []
    for e in events:
        cam = site.camera(e["camera_id"])
        v = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"], site=site, camera=cam,
                     rules=rules)
        near_blank = any(b["camera_id"] != e["camera_id"] and abs(b["ts"] - e["ts"]) <= CAMERA_DOWN_WINDOW for b in blanks)
        person = (e["report"] or {}).get("person_present") == "yes"
        if v.severity in (NEEDS_LOOK, UNCONFIRMED) or e["kind"] == "blank_view" or (near_blank and person):
            if near_blank and person and v.severity not in (NEEDS_LOOK, UNCONFIRMED):
                v.reasons.append({"label": "Another camera went blank at the same time", "source": "rule"})
            out.append((e, v))
    return out


def escalate_flagged(site: Site, store: Store, claude: Claude, night: date, media_root: Path, log=print) -> None:
    for e, _ in _flagged(site, store, night):
        if e["report"]:
            escalate(site, store, claude, e, media_root, log)


def build_incidents(site: Site, store: Store, claude: Claude | None, night: date, log=print) -> None:
    flagged = _flagged(site, store, night)

    groups: list[list[tuple[dict, object]]] = []
    for e, v in flagged:
        if groups and e["ts"] - max(x["end_ts"] for x, _ in groups[-1]) <= INCIDENT_GAP:
            groups[-1].append((e, v))
        else:
            groups.append([(e, v)])

    keep = []
    for g in groups:
        events = [e for e, _ in g]
        g_start, g_end = events[0]["ts"], max(e["end_ts"] for e in events)
        alarm = verify_alarm(site, store, g_start, g_end)
        headline, by = _headline(site, claude, g, alarm)
        iid = store.save_incident(site.id, str(night), str(events[0]["id"]), g_start, g_end, [e["id"] for e in events],
                                  headline, by, alarm)
        keep.append(iid)
        log(f"  incident {g_start:%H:%M}-{g_end:%H:%M} ({len(events)} events): {headline}")
    store.drop_incidents_except(site.id, str(night), keep)


def _headline(site: Site, claude: Claude | None, group, alarm) -> tuple[str, str]:
    events = [e for e, _ in group]
    worst = min((v.severity for _, v in group), key=lambda s: RANK[s])
    cams = []
    for e in events:
        n = site.camera(e["camera_id"]).name
        if n not in cams:
            cams.append(n)
    first = events[0]
    fallback_act = activity_label((first["report"] or {}).get("activity"))
    fallback = f"{fallback_act} on {', '.join(cams)} at {first['ts']:%-I:%M%p}".replace("AM", "am").replace("PM", "pm")
    if claude is None:
        return fallback + ".", "rule"
    payload = [
        {"camera": site.camera(e["camera_id"]).name, "time": f"{e['ts']:%-I:%M:%S%p}".lower(),
         "summary": (e["report"] or {}).get("summary") or (
             "This camera's view went blank or was covered and stayed that way." if e["kind"] == "blank_view" else None), "activity": activity_label((e["report"] or {}).get("activity")),
         "items_carried": (e["report"] or {}).get("items_carried")}
        for e in events
    ]
    armed = "Site armed." if site.is_armed(first["ts"]) else "Site disarmed (work hours)."
    context = f"Site: {site.name}. {armed} Severity: {'needs a look' if worst == NEEDS_LOOK else 'person whose authorisation is unconfirmed'}."
    if alarm:
        context += f" An Ajax alarm triggered at {datetime.fromisoformat(alarm['at']):%-I:%M%p} ({alarm['zone']})."
    try:
        res = claude.complete_json(model=SONNET, system=HEADLINE_SYSTEM, images=[],
                                   text=f"{context}\nEvents:\n{json.dumps(payload, indent=1)}",
                                   schema=HEADLINE_SCHEMA, effort="low", max_tokens=4000)
        return res.data["headline"].strip(), "ai"
    except LLMError:
        return fallback + ".", "rule"


def verify_alarm(site: Site, store: Store, g_start: datetime, g_end: datetime) -> dict | None:
    """Match a (simulated) Ajax alarm inside or just before the incident window to footage on its camera."""
    for a in site.alarms:
        if not (g_start - timedelta(minutes=2) <= a.at <= g_end + timedelta(minutes=1)):
            continue
        near = [e for e in store.events(site.id, a.at - timedelta(seconds=90), a.at + timedelta(seconds=120))
                if e["camera_id"] == a.camera_id and e["report"]]
        cam_name = site.camera(a.camera_id).name if site.has_camera(a.camera_id) else a.camera_id
        if any(e["report"].get("person_present") == "yes" for e in near):
            verdict, text = "person_visible", f"Verified: person visible on {cam_name}"
        elif any(e["report"].get("vehicle_present") == "yes" for e in near):
            verdict, text = "vehicle_visible", f"Verified: vehicle visible on {cam_name}"
        elif near:
            verdict, text = "unclear", f"Movement on {cam_name}, but the AI couldn't tell what it was"
        else:
            verdict, text = "nothing_visible", f"Nothing moving on {cam_name} around the alarm"
        return {"at": a.at.isoformat(), "zone": a.zone, "verdict": verdict, "verdict_text": text, "simulated": True}
    return None


def analyse_site(site: Site, store: Store, claude: Claude, media_root: Path, log: Callable[[str], None] = print) -> None:
    for night in nights_for(site, store):
        log(f"[{site.id}] night of {night}")
        run_checks(site, store, claude, night, media_root, log)
        escalate_flagged(site, store, claude, night, media_root, log)
        build_incidents(site, store, claude, night, log)
