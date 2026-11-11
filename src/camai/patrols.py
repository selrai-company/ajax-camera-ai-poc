"""Guard patrol verification: did a guard visit each checkpoint in each scheduled round?

Site coverage, not people: no names, no per-guard scores, no idle detection. A visit is a
"guard" event (rostered shift + security clothing seen) on the checkpoint's camera inside the
round's window. Cameras are assumed to record continuously (as an NVR does); a checkpoint is
"unverifiable" for a round when its camera was blank or covered during the window.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from camai.rules import GUARD, evaluate
from camai.site import Site, night_window
from camai.store import Store

PRIVACY_NOTE = (
    "Patrol checks confirm that each checkpoint was visited, not who visited or how they spent their shift. "
    "No names, no individual scores, no idle or phone detection. Guards must be told these cameras check "
    "patrol coverage (workplace surveillance notice)."
)


def _at(night: date, t) -> datetime:
    d = datetime.combine(night, t)
    return d if t.hour >= 12 else d + timedelta(days=1)


def compute(site: Site, store: Store, night: date, now: datetime | None = None) -> dict | None:
    g = site.guards
    if not g:
        return None
    start, end = night_window(night)
    events = store.events(site.id, start, end)
    rules = store.rules(site.id)
    shift = (_at(night, g.shift_from), _at(night, g.shift_to))
    if shift[1] <= shift[0]:
        shift = (shift[0], shift[1] + timedelta(days=1))

    visits_by_cam: dict[str, list[dict]] = {}
    blanks_by_cam: dict[str, list[tuple[datetime, datetime]]] = {}
    for e in events:
        if not site.has_camera(e["camera_id"]):
            continue
        cam = site.camera(e["camera_id"])
        if e["kind"] == "blank_view":
            blanks_by_cam.setdefault(cam.id, []).append((e["ts"], e["end_ts"]))
            continue
        v = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"], site=site, camera=cam,
                     rules=rules)
        if v.severity == GUARD:
            visits_by_cam.setdefault(cam.id, []).append(e)

    rounds = []
    visited = due = 0
    missed_insights = []
    for r in g.rounds:
        w0 = _at(night, r)
        w1 = w0 + timedelta(minutes=g.round_window_min)
        label = f"{w0:%-I:%M%p} round".replace("AM", "am").replace("PM", "pm")
        visits = {}
        for cp in g.checkpoints:
            hits = [e for e in visits_by_cam.get(cp.camera_id, []) if w0 <= e["ts"] <= w1]
            blank = any(a <= w1 and b >= w0 for a, b in blanks_by_cam.get(cp.camera_id, []))
            if now and w0 > now:
                status = "upcoming"
            elif hits:
                status = "visited"
            elif blank:
                status = "unverifiable"
            else:
                status = "missed"
            if status in ("visited", "missed"):
                due += 1
                visited += status == "visited"
            if status == "missed":
                missed_insights.append({
                    "severity": "fyi",
                    "text": f"{label}: {cp.name} not visited",
                    "event_id": None,
                })
            visits[cp.id] = {
                "status": status,
                "event_id": hits[0]["id"] if hits else None,
                "at": hits[0]["ts"] if hits else None,
            }
        rounds.append({"label": label, "window": (w0, w1), "visits": visits})

    insights = list(missed_insights)
    # Longest stretch without a visit, per checkpoint, during the shift
    for cp in g.checkpoints:
        times = sorted(e["ts"] for e in visits_by_cam.get(cp.camera_id, []) if shift[0] <= e["ts"] <= shift[1])
        marks = [shift[0], *times, min(shift[1], now or shift[1])]
        gap = max((b - a for a, b in zip(marks, marks[1:], strict=False)), default=timedelta(0))
        if gap >= timedelta(hours=4):
            hours = gap.total_seconds() / 3600
            insights.append({"severity": "fyi", "text": f"{cp.name} not visited for {hours:.0f} hours", "event_id": None})
    complete = [r for r in rounds if r["visits"] and all(v["status"] == "visited" for v in r["visits"].values())]
    for r in complete:
        insights.append({"severity": "guard", "text": f"{r['label']} complete: all {len(r['visits'])} checkpoints visited",
                         "event_id": next(iter(r["visits"].values()))["event_id"]})

    return {
        "shift": shift,
        "checkpoints": [{"id": cp.id, "name": cp.name, "camera_id": cp.camera_id} for cp in g.checkpoints],
        "rounds": rounds,
        "insights": insights,
        "coverage_pct": round(100 * visited / due) if due else None,
        "missed": missed_insights,
        "privacy_note": PRIVACY_NOTE,
    }
