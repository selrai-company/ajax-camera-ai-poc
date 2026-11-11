"""Score stored results against hand labels.

The motion gate and the AI are scored separately: if the gate misses an event the AI
never sees it, and a blended number would hide that.

Labels live in ``labels/<site_id>/<camera_id>.json`` and are written before any
model is run. See labels/README.md for the format.
"""

from __future__ import annotations

import json
from pathlib import Path

from camai.ingest import probe
from camai.rules import NEEDS_LOOK, evaluate
from camai.site import Site
from camai.store import Store


def _overlap(a0: float, a1: float, b0: float, b1: float) -> bool:
    return a0 < b1 and b0 < a1


def run_eval(site: Site, store: Store, labels_dir: Path, json_out: bool = False) -> str:
    events = store.events(site.id)
    rows = []
    tot = dict(labelled=0, gated=0, should_flag=0, flagged=0, false_flags=0, hours=0.0, cost=0.0,
               motion_events=0, pp_n=0, pp_ok=0, pa_n=0, pa_ok=0)
    for cam in site.cameras:
        lf = labels_dir / site.id / f"{cam.id}.json"
        if not lf.exists():
            continue
        lab = json.loads(lf.read_text())
        hours = probe(cam.file).duration / 3600
        cam_events = [e for e in events if e["camera_id"] == cam.id and (e["kind"] == "motion" or e["report"])]
        for e in cam_events:
            e["severity"] = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"],
                                     site=site, camera=cam).severity
        targets = [x for x in lab["events"] if x["what"] in ("person", "vehicle")]
        gated = flagged = 0
        for x in targets:
            # Any overlap counts, so one long event can cover several labels; see "events" beside the counts.
            hits = [e for e in cam_events if _overlap(x["start"], x["end"], e["start_s"], e["end_s"])]
            gated += bool(hits)
            if x.get("should_flag"):
                flagged += any(e["severity"] == NEEDS_LOOK for e in hits)
        # AI accuracy per event, split by whether a person was really there. "cant_tell" never counts as correct.
        pp_n = pp_ok = pa_n = pa_ok = 0
        for e in cam_events:
            if not e["report"]:
                continue
            person_there = any(
                x["what"] == "person" and _overlap(x["start"], x["end"], e["start_s"], e["end_s"]) for x in lab["events"]
            )
            said = e["report"]["person_present"]
            if person_there:
                pp_n += 1
                pp_ok += said == "yes"
            else:
                pa_n += 1
                pa_ok += said == "no"
        should = [x for x in lab["events"] if x.get("should_flag")]
        false_flags = sum(
            1 for e in cam_events
            if e["severity"] == NEEDS_LOOK
            and not any(_overlap(x["start"], x["end"], e["start_s"], e["end_s"]) for x in should)
        )
        cost = sum((e["llm"] or {}).get("est_api_cost_usd", 0) for e in cam_events)
        rows.append(dict(camera=cam.id, held_out=lab.get("held_out", False), labelled=len(targets), gated=gated,
                         should_flag=len(should), flagged=flagged, false_flags=false_flags,
                         motion_events=len(cam_events), hours=round(hours, 3), cost=round(cost, 5),
                         pp_n=pp_n, pp_ok=pp_ok, pa_n=pa_n, pa_ok=pa_ok))
        for k in tot:
            tot[k] += rows[-1][k]

    def pct(a, b):
        return f"{100 * a / b:.0f}% ({a}/{b})" if b else "n/a"

    summary = {
        "gate_recall": pct(tot["gated"], tot["labelled"]),
        "end_to_end_recall": pct(tot["flagged"], tot["should_flag"]),
        "ai_person_present_correct": pct(tot["pp_ok"], tot["pp_n"]),
        "ai_person_absent_correct": pct(tot["pa_ok"], tot["pa_n"]),
        "false_flags_per_hour": round(tot["false_flags"] / tot["hours"], 2) if tot["hours"] else None,
        "est_api_cost_per_camera_hour": round(tot["cost"] / tot["hours"], 4) if tot["hours"] else None,
        "est_api_cost_per_event": round(tot["cost"] / tot["motion_events"], 5) if tot["motion_events"] else None,
        "footage_hours": round(tot["hours"], 3),
        "totals": tot,
        "cameras": rows,
    }
    if json_out:
        return json.dumps(summary, indent=1)
    lines = [f"Evaluation: {site.name}  ({summary['footage_hours']} h of labelled footage)", ""]
    lines.append(f"{'camera':<13}{'held out':<9}{'events':>7}{'gated':>9}{'flagged':>9}{'false':>7}"
                 f"{'person yes':>12}{'person no':>11}{'cost $':>9}")
    for r in rows:
        lines.append(
            f"{r['camera']:<13}{'yes' if r['held_out'] else '':<9}{r['motion_events']:>7}"
            f"{r['gated']:>6}/{r['labelled']:<2}{r['flagged']:>6}/{r['should_flag']:<2}{r['false_flags']:>7}"
            f"{r['pp_ok']:>9}/{r['pp_n']:<2}{r['pa_ok']:>8}/{r['pa_n']:<2}{r['cost']:>9.4f}"
        )
    lines += [
        "",
        f"Gate recall (labelled person/vehicle events overlapped by a gate event): {summary['gate_recall']}",
        f"End-to-end recall (should-flag labels overlapped by a 'needs a look' event): {summary['end_to_end_recall']}",
        f"AI said 'person' when a person was there: {summary['ai_person_present_correct']}",
        f"AI said 'no person' when none was there (cant_tell counts as wrong): {summary['ai_person_absent_correct']}",
        f"False 'needs a look' flags per hour of footage: {summary['false_flags_per_hour']}",
        f"Estimated API cost per described event: ${summary['est_api_cost_per_event']}",
        f"Estimated API cost per camera-hour: ${summary['est_api_cost_per_camera_hour']} "
        "(stand-in clips are wall-to-wall events, so this is far above a real quiet night)",
        "",
        "Recall counts any overlap, so one long event can cover several labels. On short clips that are",
        "mostly activity, gate recall is close to 100% by construction; compare 'events' with the label counts.",
    ]
    return "\n".join(lines)
