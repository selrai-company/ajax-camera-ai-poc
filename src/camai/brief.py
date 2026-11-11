"""The morning brief: one screen per site that answers "is my site okay?".

Severity comes from the rules. Sonnet only writes the one-line headline and short
titles when there is something to look at; a quiet night is written in plain code
(no AI call, so it is free and always says the same thing).
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from camai.llm import SONNET, Claude, LLMError
from camai.rules import CAMERA_ISSUE, FYI, IGNORE, NEEDS_LOOK, evaluate
from camai.site import Site
from camai.store import Store

ORDER = {NEEDS_LOOK: 0, CAMERA_ISSUE: 1, FYI: 2, IGNORE: 3}

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"event_id": {"type": "integer"}, "title": {"type": "string"}},
                "required": ["event_id", "title"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["headline", "items"],
    "additionalProperties": False,
}

BRIEF_SYSTEM = """You write the 6am morning brief for a job-site manager from camera event reports.
- headline: one sentence, at most 20 words, saying what needs their attention. Plain English, Australian spelling. Don't state how many events there were; the page shows exact counts.
- items: for each event given, a title of at most 12 words saying what happened, factual and calm. Do not repeat the camera name or the time; the page already shows them.
- Report only what the event reports say. Never add guesses about identity or intent, and never call anyone suspicious.
- Where events on different cameras look like the same person or vehicle moving through the site, you may say so in the headline, using "appears to"."""


def build_brief(site: Site, store: Store, claude: Claude | None) -> dict[str, Any]:
    rules = store.rules(site.id)
    events = []
    known = {c.id for c in site.cameras}
    for e in store.events(site.id):
        if e["camera_id"] not in known:  # camera removed from the site config
            continue
        cam = site.camera(e["camera_id"])
        v = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"], site=site, camera=cam, rules=rules)
        events.append({**e, "severity": v.severity, "reasons": v.reasons, "camera_name": cam.name})
    events.sort(key=lambda e: (ORDER[e["severity"]], e["ts"]))

    flagged = [e for e in events if e["severity"] in (NEEDS_LOOK, FYI, CAMERA_ISSUE)]
    counts = Counter(e["severity"] for e in events)
    ignored = Counter(e["reasons"][0] for e in events if e["severity"] == IGNORE)
    cost = sum((e["llm"] or {}).get("est_api_cost_usd", 0) for e in events)

    if counts[NEEDS_LOOK]:
        status = NEEDS_LOOK
    elif counts[CAMERA_ISSUE]:
        status = CAMERA_ISSUE
    elif counts[FYI]:
        status = FYI
    else:
        status = "all_good"

    titles: dict[int, str] = {}
    brief_llm = None
    brief_error = None
    if not flagged:
        headline = f"Quiet night. {len(events)} movements checked, nothing needs you."
    else:
        headline = f"{counts[NEEDS_LOOK]} thing(s) to look at, {counts[FYI]} for your information."
    if flagged and claude is not None:
        payload = [
            {
                "event_id": e["id"],
                "camera": e["camera_name"],
                "time": e["ts"].strftime("%H:%M"),
                "severity": e["severity"],
                "reasons": e["reasons"],
                "report": e["report"] or {"kind": e["kind"]},
            }
            for e in flagged
        ]
        try:
            res = claude.complete_json(
                model=SONNET,
                system=BRIEF_SYSTEM,
                images=[],
                text=f"Site: {site.name}\nEvents:\n{json.dumps(payload, indent=1, default=str)}",
                schema=BRIEF_SCHEMA,
                effort="medium",  # low effort occasionally garbled the headline
                max_tokens=8000,  # includes thinking tokens
            )
            headline = res.data["headline"]
            titles = {i["event_id"]: i["title"] for i in res.data["items"]}
            brief_llm = {"model": res.model, "est_api_cost_usd": round(res.est_api_cost_usd, 6), "cached": res.cached}
            cost += res.est_api_cost_usd
        except LLMError as e:
            # The brief still works without the AI headline: plain-code headline, Haiku summaries as titles.
            brief_error = str(e)[:300]

    for e in events:
        e["title"] = titles.get(e["id"]) or (e["report"] or {}).get("summary") or e["reasons"][0]
        e["ts"] = e["ts"].isoformat()

    return {
        "site": {"id": site.id, "name": site.name, "armed": f"{site.armed_from:%H:%M} to {site.armed_to:%H:%M}"},
        "status": status,
        "headline": headline,
        "counts": dict(counts),
        "ignored_reasons": dict(ignored),
        "cameras": [{"id": c.id, "name": c.name} for c in site.cameras],
        "events": events,
        "est_api_cost_usd": round(cost, 5),
        "brief_llm": brief_llm,
        "brief_error": brief_error,
    }
