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
               ai_pairs=0, ai_correct=0, motion_events=0)
    for cam in site.cameras:
        lf = labels_dir / site.id / f"{cam.id}.json"
        if not lf.exists():
            continue
        lab = json.loads(lf.read_text())
        hours = probe(cam.file).duration / 3600
        cam_events = [e for e in events if e["camera_id"] == cam.id and e["kind"] == "motion"]
        for e in cam_events:
            e["severity"] = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"],
                                     site=site, camera=cam).severity
        targets = [x for x in lab["events"] if x["what"] in ("person", "vehicle")]
        gated = flagged = ai_pairs = ai_correct = 0
        for x in targets:
            hits = [e for e in cam_events if _overlap(x["start"], x["end"], e["start_s"], e["end_s"])]
            gated += bool(hits)
            if x.get("should_flag"):
                flagged += any(e["severity"] == NEEDS_LOOK for e in hits)
            for e in hits:
                if e["report"]:
                    ai_pairs += 1
                    ai_correct += (e["report"]["person_present"] == "yes") == (x["what"] == "person")
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
                         ai_pairs=ai_pairs, ai_correct=ai_correct))
        for k in tot:
            tot[k] += rows[-1][k]

    def pct(a, b):
        return f"{100 * a / b:.0f}%" if b else "n/a"

    summary = {
        "gate_recall": pct(tot["gated"], tot["labelled"]),
        "end_to_end_recall": pct(tot["flagged"], tot["should_flag"]),
        "ai_person_accuracy": pct(tot["ai_correct"], tot["ai_pairs"]),
        "false_flags_per_hour": round(tot["false_flags"] / tot["hours"], 2) if tot["hours"] else None,
        "est_api_cost_per_camera_hour": round(tot["cost"] / tot["hours"], 4) if tot["hours"] else None,
        "footage_hours": round(tot["hours"], 3),
        "totals": tot,
        "cameras": rows,
    }
    if json_out:
        return json.dumps(summary, indent=1)
    lines = [f"Evaluation: {site.name}  ({summary['footage_hours']} h of labelled footage)", ""]
    lines.append(f"{'camera':<10}{'held out':<10}{'gate':>8}{'flagged':>10}{'false':>7}{'AI person':>11}{'cost $':>10}")
    for r in rows:
        lines.append(
            f"{r['camera']:<10}{'yes' if r['held_out'] else '':<10}{r['gated']:>4}/{r['labelled']:<3}"
            f"{r['flagged']:>6}/{r['should_flag']:<3}{r['false_flags']:>6}{r['ai_correct']:>7}/{r['ai_pairs']:<3}{r['cost']:>10.4f}"
        )
    lines += [
        "",
        f"Gate recall (person/vehicle events caught by motion gate): {summary['gate_recall']}",
        f"End-to-end recall (should-flag events marked 'needs a look'): {summary['end_to_end_recall']}",
        f"AI person present/absent accuracy on gated events: {summary['ai_person_accuracy']}",
        f"False 'needs a look' flags per hour of footage: {summary['false_flags_per_hour']}",
        f"Estimated API cost per camera-hour: ${summary['est_api_cost_per_camera_hour']}",
    ]
    return "\n".join(lines)
