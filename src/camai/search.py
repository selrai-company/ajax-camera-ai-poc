"""Plain-English search across recorded events.

1. Haiku turns the question into filters (cameras, time range, subjects) and keywords.
2. Candidates: stored events matching the filters, scored on their AI text (title, summary,
   movement, search_text, vehicles, items). Fine at site scale; use SQLite FTS5 or embeddings
   when the event count grows into the tens of thousands.
3. Sonnet picks the events that actually answer the question, writes a one-sentence answer
   citing them, and says why each matches.
4. Haiku re-checks the top few against their frames ("Checked on frames").

Limits are said out loud: it only finds moments the motion gate caught, only what the AI
described, and it never identifies people.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta

from camai.checks import HaikuChecker
from camai.llm import HAIKU, SONNET, Claude, Image, LLMError
from camai.rules import activity_label
from camai.site import Site, night_window
from camai.store import Store

INTERPRET_SCHEMA = {
    "type": "object",
    "properties": {
        "cameras": {"type": "array", "items": {"type": "string"}},
        "start_time": {"type": "string"},
        "end_time": {"type": "string"},
        "subjects": {"type": "array", "items": {"type": "string"}},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "asks_identity": {"type": "boolean"},
    },
    "required": ["cameras", "start_time", "end_time", "subjects", "keywords", "summary", "asks_identity"],
    "additionalProperties": False,
}

RANK_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "integer"},
                    "why": {"type": "string"},
                    "highlights": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["event_id", "why", "highlights"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answer", "matches"],
    "additionalProperties": False,
}

STOP = set("a an the and or of to in on at for with by from is was were be been any did does do when what who show me "
           "find all there have has near after before last night this today yesterday site camera".split())


def _text(site: Site, e: dict) -> str:
    r = e["report"] or {}
    cam = site.camera(e["camera_id"]).name if site.has_camera(e["camera_id"]) else e["camera_id"]
    return " ".join([
        cam, r.get("title", ""), r.get("summary", ""), r.get("movement", ""), r.get("search_text", ""),
        activity_label(r.get("activity")), " ".join(r.get("vehicle_types") or []), " ".join(r.get("items_carried") or []),
        "person people" if r.get("person_present") == "yes" else "", "vehicle" if r.get("vehicle_present") == "yes" else "",
        "security guard" if r.get("security_uniform") == "yes" else "", "hi-vis" if r.get("hi_vis") == "yes" else "",
    ]).lower()


def _tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9-]+", s.lower()) if t not in STOP and len(t) > 1}


def _to_dt(night: date, hhmm: str) -> datetime | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", (hhmm or "").strip())
    if not m:
        return None
    h, mi = int(m[1]), int(m[2])
    d = datetime.combine(night, datetime.min.time()).replace(hour=h % 24, minute=mi)
    return d if h >= 12 else d + timedelta(days=1)


def search(site: Site, store: Store, claude: Claude, q: str, night: date | None = None, top: int = 8) -> dict:
    cost = 0.0
    cams = [{"id": c.id, "name": c.name} for c in site.cameras]
    if night is None:
        from camai.serialize import site_out

        night = date.fromisoformat(site_out(site, store)["default_night"])
    w0, w1 = night_window(night) if night else (None, None)

    try:
        res = claude.complete_json(
            model=HAIKU,
            system=("You turn a site manager's question about security camera footage into search filters. "
                    "Cameras: " + json.dumps(cams) + ". Times are local, 24h HH:MM, within one night (afternoon to next morning). "
                    "Leave start_time/end_time empty when the question gives no time. cameras: ids only, empty for all. "
                    "subjects: things to look for (person, vehicle, excavator, ute, delivery truck...). keywords: 3-10 search "
                    "words incl. synonyms (ute, pickup, utility). summary: the interpreted search in under 12 words. "
                    "asks_identity: true if the question asks who someone is or to find a named person."),
            images=[], text=q, schema=INTERPRET_SCHEMA, effort="low", max_tokens=2000)
        f = res.data
        cost += res.est_api_cost_usd
    except LLMError:
        f = {"cameras": [], "start_time": "", "end_time": "", "subjects": [], "keywords": list(_tokens(q)),
             "summary": q, "asks_identity": False}

    start = _to_dt(night, f["start_time"]) if night and f["start_time"] else w0
    end = _to_dt(night, f["end_time"]) if night and f["end_time"] else w1
    if start and end and end <= start:
        end += timedelta(days=1)
    want_cams = {c for c in f["cameras"] if site.has_camera(c)}

    events = [e for e in store.events(site.id, w0, w1)
              if e["report"] and site.has_camera(e["camera_id"])
              and (not want_cams or e["camera_id"] in want_cams)
              and (start is None or e["end_ts"] >= start) and (end is None or e["ts"] <= end)]
    terms = _tokens(" ".join([*f["keywords"], *f["subjects"], q]))
    scored = sorted(((len(terms & _tokens(_text(site, e))), e) for e in events), key=lambda x: (-x[0], x[1]["ts"]))
    candidates = [e for s, e in scored[:30]] if len(events) > 30 else events

    answer, matches = None, []
    if candidates:
        payload = [{"event_id": e["id"], "camera": site.camera(e["camera_id"]).name,
                    "time": f"{e['ts']:%a %-I:%M%p}".replace("AM", "am").replace("PM", "pm"),
                    "title": e["report"].get("title"), "summary": e["report"].get("summary"),
                    "objects": e["report"].get("search_text")} for e in candidates]
        try:
            res = claude.complete_json(
                model=SONNET,
                system=("You answer a site manager's question using only these camera event records. Return the events "
                        "that genuinely answer it (best first, at most 8) with a short 'why' (under 14 words, starting "
                        "'Matches:') and 1-4 highlight words copied from the record. answer: one sentence citing events "
                        "like [#12]; if nothing matches, say no matching recorded events were found. Never identify "
                        "anyone or guess intent. Australian spelling."),
                images=[], text=f"Question: {q}\nRecords:\n{json.dumps(payload, indent=1)}",
                schema=RANK_SCHEMA, effort="low", max_tokens=6000)
            cost += res.est_api_cost_usd
            answer = res.data["answer"]
            ids = {e["id"]: e for e in candidates}
            matches = [m for m in res.data["matches"] if m["event_id"] in ids][:top]
        except LLMError:
            matches = [{"event_id": e["id"], "why": "Matches your search words", "highlights": []}
                       for s, e in scored[:top] if s > 0]

    by_id = {e["id"]: e for e in candidates}
    results = []
    checker = HaikuChecker(claude)
    for i, m in enumerate(matches):
        e = by_id[m["event_id"]]
        check = None
        if i < 3 and e["media"].get("key_frame"):
            img_path = store_media_path(store, e)
            if img_path:
                try:
                    # Ask only about what a single picture can show (not times or places from the filters).
                    things = ", ".join(f["subjects"] or f["keywords"][:4]) or q
                    r = checker.check(f"Does this camera image show any of these: {things}?", ["yes", "no"],
                                      [Image.from_path(img_path)])
                    cost += r.est_cost_usd
                    check = "confirmed" if r.answer == "yes" else "not_confirmed"
                except LLMError:
                    check = None
        results.append({"event": e, "why": m["why"], "highlights": m["highlights"],
                        "checked_on_frames": check is not None, "frame_check": check})

    note = "This system doesn't identify people. It describes what happened, not who." if f["asks_identity"] else (
        "Searches what the AI described in recorded events. Moments the motion detector didn't catch can't be found.")
    return {"query": q, "interpreted": {"cameras": sorted(want_cams), "start": start, "end": end,
                                        "subjects": f["subjects"], "keywords": f["keywords"], "summary": f["summary"]},
            "answer": answer, "results": results, "note": note, "est_cost_usd": round(cost, 5)}


MEDIA_ROOT = None  # set by the API at startup


def store_media_path(store: Store, e: dict):
    from pathlib import Path

    if MEDIA_ROOT is None:
        return None
    p = Path(MEDIA_ROOT) / e["media"]["dir"] / e["media"]["key_frame"]
    return p if p.exists() else None
