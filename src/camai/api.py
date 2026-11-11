"""FastAPI service: the /api/v1 JSON contract (docs/API.md, web/src/api/types.ts), media files,
and the built React app.

No login: run it behind the host app's auth, bound to 127.0.0.1 by default.
`require_page` only blocks cross-site requests; it is not authentication (see INTEGRATION.md).
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from camai import insights, patrols, search
from camai.analysis import build_incidents
from camai.evidence import build_pdf
from camai.llm import SONNET, Claude, LLMError
from camai.rules import CAMERA_ISSUE, FYI, IGNORE, NEEDS_LOOK, RANK, UNCONFIRMED, SuppressRule, activity_label
from camai.serialize import Ctx, camera_tiles, media_url, site_out
from camai.site import Site, night_window
from camai.store import Store

APP_DIR = Path(__file__).parent / "static" / "app"

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {"headline": {"type": "string"}},
    "required": ["headline"],
    "additionalProperties": False,
}
BRIEF_SYSTEM = """You write the one-sentence 6am headline for a job-site manager about last night, from structured findings.
- At most 24 words. Lead with what needs their attention most. Plain English, Australian spelling, calm.
- Don't state counts the page already shows. Never identify anyone or guess intent. Only use the findings given."""


class SearchBody(BaseModel):
    site_id: str
    q: str
    night: str | None = None


class StatusBody(BaseModel):
    status: str


class RuleBody(BaseModel):
    event_id: int


def create_app(sites: list[Site], store: Store, media_root: Path, claude: Claude | None) -> FastAPI:
    app = FastAPI(title="Camera AI layer", version="1.1")
    by_id = {s.id: s for s in sites}
    media_root.mkdir(parents=True, exist_ok=True)
    search.MEDIA_ROOT = media_root
    app.mount("/media", StaticFiles(directory=media_root), name="media")

    # ---- helpers ------------------------------------------------------------
    def require_page(x_camai: str | None) -> None:
        # Changes need a custom header the app sends. Another website can't add it without a
        # CORS preflight, which this service never allows. Not authentication.
        if x_camai != "1":
            raise HTTPException(403, "Missing X-Camai header")

    def site_or_404(site_id: str) -> Site:
        if site_id not in by_id:
            raise HTTPException(404, "Unknown site")
        return by_id[site_id]

    def night_param(site: Site, night: str | None) -> date:
        return date.fromisoformat(night or site_out(site, store)["default_night"])

    def night_events(ctx: Ctx, night: date) -> list[dict]:
        w0, w1 = night_window(night)
        return [e for e in store.events(ctx.site.id, w0, w1) if ctx.site.has_camera(e["camera_id"])]

    def lockup_out(ctx: Ctx, night: date) -> list[dict]:
        out = []
        for r in store.lockup(ctx.site.id, str(night)):
            if r["phase"].startswith("asset_") or not ctx.site.has_camera(r["camera_id"]):
                continue
            out.append({"camera_id": r["camera_id"], "camera_name": ctx.site.camera(r["camera_id"]).name,
                        "question": r["question"], "answer": r["answer"], "ok": r["ok"], "at": ctx.iso(r["at"]),
                        "image": f"/media/{r['image']}" if r["image"] else None, "why": r["why"] or ""})
        return out

    def assets_out(ctx: Ctx, night: date) -> list[dict]:
        def snap(r):
            return {"present": r["answer"], "at": ctx.iso(r["at"]),
                    "image": f"/media/{r['image']}" if r["image"] else None} if r else None

        return [{"camera_id": a["camera_id"], "camera_name": a["camera_name"], "asset": a["asset"],
                 "evening": snap(a["evening"]), "morning": snap(a["morning"]), "status": a["status"], "text": a["text"]}
                for a in insights.asset_checks(ctx.site, store, night)]

    def patrols_out(ctx: Ctx, night: date) -> dict | None:
        p = patrols.compute(ctx.site, store, night)
        if p is None:
            return None
        return {
            "site_id": ctx.site.id, "night": str(night),
            "shift": {"start": ctx.iso(p["shift"][0]), "end": ctx.iso(p["shift"][1])},
            "checkpoints": p["checkpoints"],
            "rounds": [{"label": r["label"], "window": {"start": ctx.iso(r["window"][0]), "end": ctx.iso(r["window"][1])},
                        "visits": {k: {**v, "at": ctx.iso(v["at"])} for k, v in r["visits"].items()}}
                       for r in p["rounds"]],
            "insights": p["insights"], "coverage_pct": p["coverage_pct"], "privacy_note": p["privacy_note"],
        }

    def repeat_out(ctx: Ctx, night: date) -> list[dict]:
        return [{"description": r["description"], "nights": r["nights"], "text": r["text"],
                 "sightings": [{"event_id": e["id"], "at": ctx.iso(e["ts"]),
                                "camera_name": ctx.site.camera(e["camera_id"]).name,
                                "image": media_url(e["media"].get("dir"), e["media"].get("key_frame"))}
                               for e in r["events"]]}
                for r in insights.repeat_vehicles(ctx.site, store, night)]

    def preview(ctx: Ctx, e: dict) -> dict:
        activity = (e["report"] or {}).get("activity", "other")
        h = e["ts"].hour
        rule = {"site_id": ctx.site.id, "camera_id": e["camera_id"], "activity": activity,
                "hour_from": (h - 1) % 24, "hour_to": (h + 1) % 24,
                "note": f"{activity_label(activity).lower()} on {ctx.site.camera(e['camera_id']).name} around {h:02d}:00"}
        sr = SuppressRule(0, rule["camera_id"], activity, rule["hour_from"], rule["hour_to"])
        would = sum(1 for x in store.events(ctx.site.id)
                    if x["report"] and sr.matches(x["camera_id"], x["report"].get("activity", "other"), x["ts"]))
        person = (e["report"] or {}).get("person_present") == "yes"
        return {"event_id": e["id"], "rule": rule,
                "description": f"Hide '{activity_label(activity).lower()}' on {ctx.site.camera(e['camera_id']).name} "
                               f"between {rule['hour_from']:02d}:00 and {rule['hour_to']:02d}:59 every night",
                "would_hide": would,
                "caveat": "A person seen while the site is armed is never hidden completely; it shows as Unconfirmed."
                if person else None}

    def brief(ctx: Ctx, night: date) -> dict:
        events = night_events(ctx, night)
        outs = [ctx.event(e) for e in events]
        incs = [ctx.incident(i) for i in store.incidents(ctx.site.id, str(night)) if i["status"] != "dismissed"]
        incs.sort(key=lambda i: (RANK.get(i["severity"], 9), i["start"]))
        fyi = [o for o in outs if o["severity"] in (FYI,) and o["incident_id"] is None]
        ignored = [o for o in outs if o["severity"] == IGNORE]
        health = [{"camera_id": o["camera_id"], "camera_name": o["camera_name"], "status": "blank",
                   "note": o["reasons"][0]["label"]} for o in outs if o["severity"] == CAMERA_ISSUE]
        lock = lockup_out(ctx, night)
        assets = assets_out(ctx, night)
        pat = patrols_out(ctx, night)
        repeats = repeat_out(ctx, night)
        sugg = [{"camera_id": s["camera_id"], "camera_name": s["camera_name"], "activity_label": s["activity_label"],
                 "dismissed_count": s["dismissed_count"], "preview": preview(ctx, s["event"])}
                for s in insights.suggestions(ctx.site, store)]
        delivs = [ctx.event(e) for e in insights.deliveries(ctx.site, events)]
        open_incs = [i for i in incs if i["status"] == "open"]
        if any(i["severity"] in (NEEDS_LOOK, UNCONFIRMED) for i in open_incs) or any(a["status"] == "missing" for a in assets):
            status = "needs_look"
        elif health:
            status = "camera_issue"
        elif fyi or (pat and pat["insights"] and any(x["severity"] == "fyi" for x in pat["insights"])) or \
                any(not c["ok"] for c in lock):
            status = "fyi"
        else:
            status = "all_good"
        headline, by = "Quiet night. Nothing needed a look.", "rule"
        if status != "all_good":
            findings = {
                "incidents": [i["headline"] for i in open_incs],
                "assets": [a["text"] for a in assets if a["status"] in ("missing", "arrived")],
                "missed_patrols": [x["text"] for x in (pat or {}).get("insights", []) if x["severity"] == "fyi"],
                "lockup_problems": [f"{c['camera_name']}: {c['question']} -> {c['answer']}" for c in lock if not c["ok"]],
                "camera_issues": [f"{h['camera_name']}: {h['note']}" for h in health],
                "fyi": [o["title"] for o in fyi][:6],
                "repeat_vehicles": [r["text"] for r in repeats],
            }
            headline = f"{len(open_incs)} incident(s) to look at." if open_incs else "A few things to check from last night."
            if claude is not None:
                try:
                    res = claude.complete_json(model=SONNET, system=BRIEF_SYSTEM, images=[],
                                               text=f"Site: {ctx.site.name}\nFindings:\n{json.dumps(findings, indent=1)}",
                                               schema=BRIEF_SCHEMA, effort="low", max_tokens=3000)
                    headline, by = res.data["headline"], "ai"
                except LLMError:
                    pass
        cost = sum((e.get("llm") or {}).get("est_api_cost_usd", 0) for e in events)
        return {
            "site_id": ctx.site.id, "night": str(night), "status": status, "headline": headline, "headline_by": by,
            "incidents": incs, "fyi": fyi,
            "ignored": {"count": len(ignored), "reasons": dict(Counter(o["reasons"][0]["label"] for o in ignored))},
            "lockup": lock,
            "patrol": {"coverage_pct": pat["coverage_pct"], "missed": [x for x in pat["insights"] if x["severity"] == "fyi"]}
            if pat else None,
            "health": health, "est_cost_usd": round(cost, 4),
            "deliveries": delivs, "assets": assets, "repeat_vehicles": repeats, "suggestions": sugg,
        }

    # ---- routes ---------------------------------------------------------------
    @app.get("/api/v1/sites")
    def list_sites():
        return [site_out(s, store) for s in sites]

    @app.get("/api/v1/sites/{site_id}/wall")
    def wall(site_id: str, night: str | None = None):
        site = site_or_404(site_id)
        n = night_param(site, night)
        ctx = Ctx(site, store)
        events = night_events(ctx, n)
        w0, w1 = night_window(n)
        return {
            "site_id": site.id, "night": str(n), "window": {"start": ctx.iso(w0), "end": ctx.iso(w1)},
            "cameras": camera_tiles(ctx, n, events),
            "events": [ctx.event(e) for e in events],
            "incidents": [ctx.incident(i) for i in store.incidents(site.id, str(n))],
        }

    @app.get("/api/v1/sites/{site_id}/brief")
    def get_brief(site_id: str, night: str | None = None):
        site = site_or_404(site_id)
        return brief(Ctx(site, store), night_param(site, night))

    @app.get("/api/v1/sites/{site_id}/incidents")
    def list_incidents(site_id: str, night: str | None = None, status: str | None = None):
        site = site_or_404(site_id)
        ctx = Ctx(site, store)
        incs = store.incidents(site.id, night)
        return [ctx.incident(i) for i in incs if status is None or i["status"] == status]

    @app.get("/api/v1/incidents/{incident_id}")
    def get_incident(incident_id: int):
        inc = store.incident(incident_id)
        if not inc:
            raise HTTPException(404, "Unknown incident")
        return Ctx(site_or_404(inc["site_id"]), store).incident(inc, detail=True)

    @app.post("/api/v1/incidents/{incident_id}/status")
    def set_status(incident_id: int, body: StatusBody, x_camai: str | None = Header(default=None)):
        require_page(x_camai)
        if body.status not in ("open", "handled", "dismissed"):
            raise HTTPException(400, "status must be open, handled or dismissed")
        inc = store.incident(incident_id)
        if not inc:
            raise HTTPException(404, "Unknown incident")
        store.set_incident_status(incident_id, body.status)
        return Ctx(site_or_404(inc["site_id"]), store).incident(store.incident(incident_id))

    @app.get("/api/v1/incidents/{incident_id}/evidence.pdf")
    def evidence(incident_id: int):
        inc = store.incident(incident_id)
        if not inc:
            raise HTTPException(404, "Unknown incident")
        site = site_or_404(inc["site_id"])
        events = [store.event(i) for i in inc["event_ids"]]
        pdf = build_pdf(site, inc, [e for e in events if e], media_root)
        name = f"evidence-{site.id}-{inc['start']:%Y%m%d-%H%M}.pdf"
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{name}"'})

    @app.post("/api/v1/events/{event_id}/dismiss")
    def dismiss(event_id: int, x_camai: str | None = Header(default=None)):
        require_page(x_camai)
        e = store.event(event_id)
        if not e:
            raise HTTPException(404, "Unknown event")
        site = site_or_404(e["site_id"])
        store.set_dismissed(event_id, True)
        build_incidents(site, store, None if claude is None else claude, _night_of_event(e), log=lambda *_: None)
        return Ctx(site, store).event(store.event(event_id))

    @app.get("/api/v1/events/{event_id}/rule-preview")
    def rule_preview(event_id: int):
        e = store.event(event_id)
        if not e:
            raise HTTPException(404, "Unknown event")
        return preview(Ctx(site_or_404(e["site_id"]), store), e)

    @app.post("/api/v1/rules")
    def create_rule(body: RuleBody, x_camai: str | None = Header(default=None)):
        require_page(x_camai)
        e = store.event(body.event_id)
        if not e:
            raise HTTPException(404, "Unknown event")
        site = site_or_404(e["site_id"])
        p = preview(Ctx(site, store), e)["rule"]
        rid = store.add_rule(site.id, SuppressRule(0, p["camera_id"], p["activity"], p["hour_from"], p["hour_to"], p["note"]),
                             body.event_id)
        build_incidents(site, store, claude, _night_of_event(e), log=lambda *_: None)
        return next(r for r in rules_out(site.id) if r["id"] == rid)

    def rules_out(site_id: str) -> list[dict]:
        site = site_or_404(site_id)
        return [{"id": r["id"], "site_id": site.id, "camera_id": r["camera_id"], "activity": r["activity"],
                 "hour_from": r["hour_from"], "hour_to": r["hour_to"], "note": r["note"],
                 "created_at": r["created_at"]} for r in store.rule_rows(site.id)]

    @app.get("/api/v1/sites/{site_id}/rules")
    def list_rules(site_id: str):
        return rules_out(site_id)

    @app.delete("/api/v1/rules/{rule_id}")
    def delete_rule(rule_id: int, x_camai: str | None = Header(default=None)):
        require_page(x_camai)
        row = next((r for s in sites for r in store.rule_rows(s.id) if r["id"] == rule_id), None)
        store.delete_rule(rule_id)
        if row:
            site = by_id[row["site_id"]]
            for n in {str(i["night"]) for i in store.incidents(site.id)} or set():
                build_incidents(site, store, claude, date.fromisoformat(n), log=lambda *_: None)
        return {"ok": True}

    @app.post("/api/v1/search")
    def do_search(body: SearchBody):
        site = site_or_404(body.site_id)
        if claude is None:
            raise HTTPException(503, "Search needs the AI backend")
        res = search.search(site, store, claude, body.q, date.fromisoformat(body.night) if body.night else None)
        ctx = Ctx(site, store)
        i = res["interpreted"]
        return {**res, "interpreted": {**i, "start": ctx.iso(i["start"]), "end": ctx.iso(i["end"])},
                "results": [{**r, "event": ctx.event(r["event"])} for r in res["results"]]}

    @app.get("/api/v1/sites/{site_id}/patrols")
    def get_patrols(site_id: str, night: str | None = None):
        site = site_or_404(site_id)
        p = patrols_out(Ctx(site, store), night_param(site, night))
        if p is None:
            raise HTTPException(404, "This site has no guards configured")
        return p

    @app.get("/api/v1/sites/{site_id}/health")
    def health(site_id: str, night: str | None = None):
        site = site_or_404(site_id)
        n = night_param(site, night)
        ctx = Ctx(site, store)
        events = night_events(ctx, n)
        out = []
        for t in camera_tiles(ctx, n, events):
            blank = next((e for e in events if e["camera_id"] == t["id"] and e["kind"] == "blank_view"), None)
            out.append({"camera_id": t["id"], "camera_name": t["name"], "status": t["health"]["status"],
                        "note": t["health"]["note"], "since": ctx.iso(blank["ts"]) if blank else None,
                        "image": media_url(blank["media"].get("dir"), blank["media"].get("key_frame")) if blank else t["poster"]})
        return out

    @app.get("/api/v1/portfolio")
    def portfolio(night: str | None = None):
        rows = []
        for s in sites:
            ctx = Ctx(s, store)
            n = night_param(s, night)
            b = brief(ctx, n)
            open_incs = [i for i in b["incidents"] if i["status"] == "open"]
            unconf = sum(1 for i in open_incs if i["severity"] == UNCONFIRMED)
            missed = sum(1 for x in (b["patrol"] or {}).get("missed", []) if "round" in x["text"])
            missing = sum(1 for a in b["assets"] if a["status"] == "missing")
            reasons = []
            if open_incs:
                reasons.append(f"{len(open_incs)} open incident{'s' if len(open_incs) > 1 else ''}")
            if missing:
                reasons.append(f"{missing} asset{'s' if missing > 1 else ''} missing")
            if missed:
                reasons.append(f"{missed} patrol round{'s' if missed > 1 else ''} missed")
            if b["health"]:
                reasons.append(f"{len(b['health'])} camera issue{'s' if len(b['health']) > 1 else ''}")
            rows.append({
                "site": site_out(s, store), "night": str(n), "status": b["status"], "headline": b["headline"],
                "open_incidents": len(open_incs), "unconfirmed": unconf, "missed_rounds": missed,
                "camera_issues": len(b["health"]), "lockup_ok": all(c["ok"] for c in b["lockup"]) if b["lockup"] else None,
                "assets_missing": missing, "key_frame": open_incs[0]["key_frame"] if open_incs else None,
                "rank_reason": ", ".join(reasons) or "Quiet night",
            })
        order = {"needs_look": 0, "camera_issue": 1, "fyi": 2, "all_good": 3}
        return sorted(rows, key=lambda r: (order.get(r["status"], 9), -r["open_incidents"], -r["missed_rounds"]))

    # ---- the React app ----------------------------------------------------------
    if APP_DIR.exists():
        app.mount("/assets", StaticFiles(directory=APP_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "media/")):
            raise HTTPException(404)
        f = APP_DIR / path
        if path and f.is_file():
            return FileResponse(f)
        index = APP_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return Response("Frontend not built. Run: cd web && npm install && npm run build", media_type="text/plain")

    return app


def _night_of_event(e: dict) -> date:
    from camai.site import night_of

    return night_of(e["ts"])
