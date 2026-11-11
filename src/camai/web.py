"""FastAPI app: a JSON API over the brief, plus one static page that renders it."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from camai.brief import build_brief
from camai.llm import Claude
from camai.rules import SuppressRule
from camai.site import Site
from camai.store import Store

STATIC = Path(__file__).parent / "static"


def create_app(sites: list[Site], store: Store, media_root: Path, claude: Claude | None) -> FastAPI:
    app = FastAPI(title="Camera AI layer (proof of concept)")
    by_id = {s.id: s for s in sites}
    media_root.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=media_root), name="media")

    def site_or_404(site_id: str) -> Site:
        if site_id not in by_id:
            raise HTTPException(404, "Unknown site")
        return by_id[site_id]

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/sites")
    def list_sites():
        return [{"id": s.id, "name": s.name} for s in sites]

    @app.get("/api/sites/{site_id}/brief")
    def brief(site_id: str):
        return build_brief(site_or_404(site_id), store, claude)

    @app.post("/api/events/{event_id}/not-a-problem")
    def not_a_problem(event_id: int):
        e = store.event(event_id)
        if not e:
            raise HTTPException(404, "Unknown event")
        site = site_or_404(e["site_id"])
        activity = (e["report"] or {}).get("activity", "other")
        h = e["ts"].hour
        note = f"{activity.replace('_', ' ')} on {site.camera(e['camera_id']).name} around {h:02d}:00"
        rule_id = store.add_rule(
            site.id, SuppressRule(0, e["camera_id"], activity, (h - 1) % 24, (h + 1) % 24, note), event_id
        )
        return {"rule_id": rule_id, "note": note}

    @app.get("/api/sites/{site_id}/rules")
    def rules(site_id: str):
        return [r.__dict__ for r in store.rules(site_or_404(site_id).id)]

    @app.delete("/api/rules/{rule_id}")
    def delete_rule(rule_id: int):
        store.delete_rule(rule_id)
        return {"ok": True}

    return app
