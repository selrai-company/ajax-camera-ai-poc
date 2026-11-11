"""Turn stored rows into the API contract shapes (web/src/api/types.ts)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from camai.ingest import probe
from camai.rules import RANK, activity_label, evaluate
from camai.site import Site, night_of, night_window
from camai.store import Store


def media_url(dir_: str | None, name: str | None) -> str | None:
    return f"/media/{dir_}/{name}" if dir_ and name else None


class Ctx:
    """Per-request context: site, store, rules and cached verdicts."""

    def __init__(self, site: Site, store: Store):
        self.site, self.store = site, store
        self.rules = store.rules(site.id)
        self._v: dict[int, Any] = {}

    def iso(self, ts: datetime | None) -> str | None:
        return self.site.iso(ts) if ts else None

    def verdict(self, e: dict):
        if e["id"] not in self._v:
            cam = self.site.camera(e["camera_id"])
            self._v[e["id"]] = evaluate(kind=e["kind"], report=e["report"], bbox=tuple(e["bbox"]), ts=e["ts"],
                                        site=self.site, camera=cam, rules=self.rules)
        return self._v[e["id"]]

    def event(self, e: dict) -> dict:
        site = self.site
        v = self.verdict(e)
        r = e["report"]
        m = e["media"] or {}
        d = m.get("dir")
        report = None
        if r:
            report = {
                "summary": r.get("summary", ""),
                "person_present": r.get("person_present", "cant_tell"),
                "people_count": int(r.get("people_count") or 0),
                "vehicle_present": r.get("vehicle_present", "cant_tell"),
                "vehicle_types": r.get("vehicle_types") or [],
                "activity": r.get("activity", "other"),
                "activity_label": activity_label(r.get("activity")),
                "items_carried": r.get("items_carried") or [],
                "movement": r.get("movement", ""),
                "cant_tell": r.get("cant_tell") or [],
                "confidence": r.get("confidence", "medium"),
                "security_uniform": r.get("security_uniform", "cant_tell"),
                "hi_vis": r.get("hi_vis", "cant_tell"),
                "search_text": r.get("search_text", ""),
                "model": (e.get("llm") or {}).get("model", "claude-haiku-5-5"),
            }
        severity = v.severity
        if e["dismissed"] and severity not in ("camera_issue",):
            severity = "ignore"
        title = (r or {}).get("title") or (r or {}).get("summary") or v.reasons[0]["label"]
        return {
            "id": e["id"],
            "site_id": site.id,
            "camera_id": e["camera_id"],
            "camera_name": site.camera(e["camera_id"]).name,
            "start": self.iso(e["ts"]),
            "end": self.iso(e["end_ts"]),
            "kind": e["kind"],
            "severity": severity,
            "title": title,
            "reasons": v.reasons if not e["dismissed"] else [{"label": "Dismissed: not a problem", "source": "rule"}, *v.reasons],
            "report": report,
            "media": {
                "clip": media_url(d, m.get("clip")),
                "frames": [media_url(d, f) for f in m.get("frames", [])],
                "crop": media_url(d, m.get("crop")),
                "key_frame": media_url(d, m.get("key_frame") or m.get("still")),
            },
            "track": m.get("track") or [],
            "moments": m.get("moments") or [],
            "incident_id": e.get("incident_id"),
            "dismissed": e["dismissed"],
        }

    def incident(self, inc: dict, events: list[dict] | None = None, detail: bool = False) -> dict:
        evs = events if events is not None else [self.store.event(i) for i in inc["event_ids"]]
        evs = [e for e in evs if e and self.site.has_camera(e["camera_id"])]
        outs = [self.event(e) for e in evs]
        why, seen = [], set()
        cams = []
        for o in outs:
            for rsn in o["reasons"]:
                if rsn["label"] not in seen:
                    seen.add(rsn["label"])
                    why.append(rsn)
            if o["camera_id"] not in [c["id"] for c in cams]:
                cams.append({"id": o["camera_id"], "name": o["camera_name"]})
        if len(cams) > 1:
            why.append({"label": f"Seen on {len(cams)} cameras", "source": "rule"})
        if inc.get("alarm"):
            why.insert(1, {"label": "Ajax alarm", "source": "rule"})
        cant = []
        for o in outs:
            for c in (o["report"] or {}).get("cant_tell", []):
                if c not in cant:
                    cant.append(c)
        sev = min((o["severity"] for o in outs), key=lambda s: RANK.get(s, 9), default="fyi")
        key = next((o["media"]["key_frame"] for o in outs if o["severity"] == sev and o["media"]["key_frame"]), None)
        alarm = None
        if inc.get("alarm"):
            a = inc["alarm"]
            alarm = {**a, "at": self.iso(datetime.fromisoformat(a["at"]))}
        out = {
            "id": inc["id"],
            "site_id": self.site.id,
            "start": self.iso(inc["start"]),
            "end": self.iso(inc["end"]),
            "severity": sev,
            "headline": inc.get("headline") or "",
            "headline_by": inc.get("headline_by") or "rule",
            "why": why,
            "cant_tell": cant[:6],
            "cameras": cams,
            "event_ids": [o["id"] for o in outs],
            "key_frame": key,
            "alarm": alarm,
            "status": inc["status"],
        }
        if detail:
            out["events"] = outs
        return out


def site_out(site: Site, store: Store) -> dict:
    nights = sorted({str(night_of(e["ts"])) for e in store.events(site.id)} |
                    {str(night_of(r.start)) for c in site.cameras for r in c.recordings})
    # Demo sites open on the night their replay starts in; otherwise the latest night.
    default = str(night_of(site.replay_start)) if site.replay_start else (nights[-1] if nights else str(date.today()))
    g = site.guards
    return {
        "id": site.id,
        "name": site.name,
        "timezone": site.timezone,
        "address_hint": site.address_hint,
        "armed": {"from": f"{site.armed_from:%H:%M}", "to": f"{site.armed_to:%H:%M}", "all_day": site.all_day},
        "guarded": g is not None,
        "guard_shift": {"from": f"{g.shift_from:%H:%M}", "to": f"{g.shift_to:%H:%M}"} if g else None,
        "nights": nights,
        "default_night": default,
        "replay_start": site.iso(site.replay_start) if site.replay_start else site.iso(night_window(date.fromisoformat(default))[0]),
        "demo": site.demo,
    }


def camera_tiles(ctx: Ctx, night: date, events: list[dict]) -> list[dict]:
    site = ctx.site
    w0, w1 = night_window(night)
    tiles = []
    for cam in site.cameras:
        segs, poster = [], None
        for rec in cam.recordings:
            dur = probe(rec.file).duration
            if rec.start + timedelta(seconds=dur) < w0 or rec.start >= w1:
                continue
            tag = f"{rec.start:%Y%m%d_%H%M%S}"
            segs.append({"src": f"/media/{site.id}/{cam.id}/wall_{tag}.mp4", "start": ctx.iso(rec.start),
                         "end": ctx.iso(rec.start + timedelta(seconds=dur))})
            poster = poster or f"/media/{site.id}/{cam.id}/poster_{tag}.jpg"
        if poster is None and cam.recordings:
            poster = f"/media/{site.id}/{cam.id}/poster_{cam.recordings[0].start:%Y%m%d_%H%M%S}.jpg"
        blanks = [e for e in events if e["camera_id"] == cam.id and e["kind"] == "blank_view"]
        health = {"status": "blank", "note": f"View blank or covered from {blanks[0]['ts']:%-I:%M%p}".replace("AM", "am").replace("PM", "pm")} \
            if blanks else {"status": "ok", "note": None}
        tiles.append({
            "id": cam.id, "name": cam.name, "poster": poster, "segments": segs, "health": health,
            "zones": [{"name": z.name, "restricted": z.restricted} for z in cam.zones],
            "checkpoint": next((cp.name for cp in (site.guards.checkpoints if site.guards else []) if cp.camera_id == cam.id), None),
        })
    return tiles
