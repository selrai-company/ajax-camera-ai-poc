"""SQLite for events, incidents, lock-up results and 'Not a problem' rules. Media lives on disk."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from camai.rules import SuppressRule

SCHEMA = """
create table if not exists events (
  id integer primary key,
  site_id text not null,
  camera_id text not null,
  kind text not null,
  start_s real not null,
  end_s real not null,
  peak_s real not null,
  bbox text not null,
  ts text not null,              -- local wall-clock start (ISO, naive)
  end_ts text,
  media text not null default '{}',
  report text,                   -- Haiku JSON
  llm text,                      -- model, tokens, cost, backend, latency
  dismissed integer not null default 0,
  incident_id integer,
  unique(site_id, camera_id, kind, ts)
);
create table if not exists incidents (
  id integer primary key,
  site_id text not null,
  night text not null,
  start text not null,
  end text not null,
  status text not null default 'open',
  headline text,
  headline_by text,
  alarm text,
  key text not null,             -- stable identity: first event id
  unique(site_id, key)
);
create table if not exists lockup (
  id integer primary key,
  site_id text not null,
  night text not null,
  camera_id text not null,
  question text not null,
  phase text not null default 'lockup',  -- lockup | perimeter | asset_evening | asset_morning
  label text,                            -- asset name for asset checks
  answer text not null,
  ok integer not null,
  at text not null,
  image text,
  why text,
  unique(site_id, night, camera_id, question, phase)
);
create table if not exists rules (
  id integer primary key,
  site_id text not null,
  camera_id text not null,
  activity text not null,
  hour_from integer not null,
  hour_to integer not null,
  note text not null default '',
  source_event_id integer,
  created_at text not null
);
"""

JSON_COLS = ("bbox", "media", "report", "llm")


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.db.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        cols = {r[1] for r in self.db.execute("pragma table_info(events)")}
        for col, ddl in (("end_ts", "text"), ("dismissed", "integer not null default 0"), ("incident_id", "integer")):
            if col not in cols:
                self.db.execute(f"alter table events add column {col} {ddl}")
        self.db.commit()

    # ---- events -----------------------------------------------------------
    def upsert_event(self, **e: Any) -> int:
        cols = ["site_id", "camera_id", "kind", "start_s", "end_s", "peak_s", "bbox", "ts", "end_ts", "media", "report", "llm"]
        vals = [e.get(c) for c in cols]
        for i, c in enumerate(cols):
            if c in JSON_COLS and vals[i] is not None:
                vals[i] = json.dumps(vals[i])
            if c in ("ts", "end_ts") and isinstance(vals[i], datetime):
                vals[i] = vals[i].isoformat()
        with self.lock:
            cur = self.db.execute(
                f"insert into events ({','.join(cols)}) values ({','.join('?' * len(cols))}) "
                "on conflict(site_id, camera_id, kind, ts) do update set "
                "start_s=excluded.start_s, end_s=excluded.end_s, peak_s=excluded.peak_s, bbox=excluded.bbox, "
                "end_ts=coalesce(excluded.end_ts, end_ts), "
                # a gate-only rerun (--no-ai) must not wipe earlier AI reports
                "media=json_patch(media, excluded.media), report=coalesce(excluded.report, report), "
                "llm=coalesce(excluded.llm, llm) returning id",
                vals,
            )
            row = cur.fetchone()
            self.db.commit()
        return int(row[0])

    def _event_row(self, r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        for k in JSON_COLS:
            d[k] = json.loads(d[k]) if d[k] else None
        d["ts"] = datetime.fromisoformat(d["ts"])
        d["end_ts"] = datetime.fromisoformat(d["end_ts"]) if d.get("end_ts") else d["ts"]
        d["dismissed"] = bool(d.get("dismissed"))
        return d

    def events(self, site_id: str, start: datetime | None = None, end: datetime | None = None) -> list[dict[str, Any]]:
        q, args = "select * from events where site_id=?", [site_id]
        if start:
            q += " and ts >= ?"
            args.append(start.isoformat())
        if end:
            q += " and ts < ?"
            args.append(end.isoformat())
        rows = self.db.execute(q + " order by ts", args).fetchall()
        return [self._event_row(r) for r in rows]

    def event(self, event_id: int) -> dict[str, Any] | None:
        r = self.db.execute("select * from events where id=?", (event_id,)).fetchone()
        return self._event_row(r) if r else None

    def set_dismissed(self, event_id: int, dismissed: bool = True) -> None:
        with self.lock:
            self.db.execute("update events set dismissed=? where id=?", (int(dismissed), event_id))
            self.db.commit()

    def clear_site(self, site_id: str) -> None:
        with self.lock:
            for t in ("events", "incidents", "lockup"):
                self.db.execute(f"delete from {t} where site_id=?", (site_id,))
            self.db.commit()

    # ---- incidents ---------------------------------------------------------
    def save_incident(self, site_id: str, night: str, key: str, start: datetime, end: datetime,
                      event_ids: list[int], headline: str, headline_by: str, alarm: dict | None) -> int:
        with self.lock:
            cur = self.db.execute(
                "insert into incidents (site_id, night, start, end, headline, headline_by, alarm, key) values (?,?,?,?,?,?,?,?) "
                "on conflict(site_id, key) do update set start=excluded.start, end=excluded.end, night=excluded.night, "
                "headline=excluded.headline, headline_by=excluded.headline_by, alarm=excluded.alarm returning id",
                (site_id, night, start.isoformat(), end.isoformat(), headline, headline_by,
                 json.dumps(alarm) if alarm else None, key),
            )
            iid = int(cur.fetchone()[0])
            self.db.execute("update events set incident_id=null where incident_id=?", (iid,))
            self.db.executemany("update events set incident_id=? where id=?", [(iid, e) for e in event_ids])
            self.db.commit()
        return iid

    def drop_incidents_except(self, site_id: str, night: str, keep_ids: list[int]) -> None:
        with self.lock:
            q = "select id from incidents where site_id=? and night=?"
            stale = [r[0] for r in self.db.execute(q, (site_id, night)) if r[0] not in keep_ids]
            for iid in stale:
                self.db.execute("update events set incident_id=null where incident_id=?", (iid,))
                self.db.execute("delete from incidents where id=?", (iid,))
            self.db.commit()

    def incidents(self, site_id: str, night: str | None = None) -> list[dict[str, Any]]:
        q, args = "select * from incidents where site_id=?", [site_id]
        if night:
            q += " and night=?"
            args.append(night)
        return [self._incident_row(r) for r in self.db.execute(q + " order by start", args)]

    def incident(self, incident_id: int) -> dict[str, Any] | None:
        r = self.db.execute("select * from incidents where id=?", (incident_id,)).fetchone()
        return self._incident_row(r) if r else None

    def _incident_row(self, r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["alarm"] = json.loads(d["alarm"]) if d["alarm"] else None
        d["start"] = datetime.fromisoformat(d["start"])
        d["end"] = datetime.fromisoformat(d["end"])
        d["event_ids"] = [x[0] for x in self.db.execute("select id from events where incident_id=? order by ts", (d["id"],))]
        return d

    def set_incident_status(self, incident_id: int, status: str) -> None:
        with self.lock:
            self.db.execute("update incidents set status=? where id=?", (status, incident_id))
            self.db.commit()

    # ---- lock-up checks ----------------------------------------------------
    def save_lockup(self, site_id: str, night: str, **c: Any) -> None:
        with self.lock:
            self.db.execute(
                "insert into lockup (site_id, night, camera_id, question, phase, label, answer, ok, at, image, why) "
                "values (?,?,?,?,?,?,?,?,?,?,?) "
                "on conflict(site_id, night, camera_id, question, phase) do update set answer=excluded.answer, "
                "ok=excluded.ok, at=excluded.at, image=excluded.image, why=excluded.why, label=excluded.label",
                (site_id, night, c["camera_id"], c["question"], c.get("phase", "lockup"), c.get("label"), c["answer"],
                 int(c["ok"]), c["at"].isoformat(), c.get("image"), c.get("why")),
            )
            self.db.commit()

    def lockup(self, site_id: str, night: str) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from lockup where site_id=? and night=? order by id", (site_id, night))
        out = []
        for r in rows:
            d = dict(r)
            d["at"] = datetime.fromisoformat(d["at"])
            d["ok"] = bool(d["ok"])
            out.append(d)
        return out

    # ---- rules -------------------------------------------------------------
    def add_rule(self, site_id: str, rule: SuppressRule, source_event_id: int | None = None) -> int:
        with self.lock:
            cur = self.db.execute(
                "insert into rules (site_id, camera_id, activity, hour_from, hour_to, note, source_event_id, created_at) "
                "values (?,?,?,?,?,?,?,?)",
                (site_id, rule.camera_id, rule.activity, rule.hour_from, rule.hour_to, rule.note,
                 source_event_id, datetime.now().isoformat(timespec="seconds")),
            )
            self.db.commit()
        return int(cur.lastrowid)

    def rules(self, site_id: str) -> list[SuppressRule]:
        rows = self.db.execute("select * from rules where site_id=? order by id", (site_id,)).fetchall()
        return [SuppressRule(r["id"], r["camera_id"], r["activity"], r["hour_from"], r["hour_to"], r["note"]) for r in rows]

    def rule_rows(self, site_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute("select * from rules where site_id=? order by id", (site_id,))]

    def delete_rule(self, rule_id: int) -> None:
        with self.lock:
            self.db.execute("delete from rules where id=?", (rule_id,))
            self.db.commit()
