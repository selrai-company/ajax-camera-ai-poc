"""SQLite for events, reports, 'Not a problem' rules and briefs. Media lives on disk."""

from __future__ import annotations

import json
import sqlite3
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
  ts text not null,              -- wall-clock time of event start (ISO)
  media text not null default '{}',
  report text,                   -- Haiku JSON
  llm text,                      -- model, tokens, cost, backend, latency
  unique(site_id, camera_id, kind, start_s)
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


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def upsert_event(self, **e: Any) -> int:
        cols = ["site_id", "camera_id", "kind", "start_s", "end_s", "peak_s", "bbox", "ts", "media", "report", "llm"]
        vals = [e.get(c) for c in cols]
        for i, c in enumerate(cols):
            if c in ("bbox", "media", "report", "llm") and vals[i] is not None:
                vals[i] = json.dumps(vals[i])
            if c == "ts" and isinstance(vals[i], datetime):
                vals[i] = vals[i].isoformat()
        cur = self.db.execute(
            f"insert into events ({','.join(cols)}) values ({','.join('?' * len(cols))}) "
            "on conflict(site_id, camera_id, kind, start_s) do update set "
            "end_s=excluded.end_s, peak_s=excluded.peak_s, bbox=excluded.bbox, ts=excluded.ts, "
            "media=excluded.media, report=excluded.report, llm=excluded.llm returning id",
            vals,
        )
        row = cur.fetchone()
        self.db.commit()
        return int(row[0])

    def events(self, site_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("select * from events where site_id=? order by ts", (site_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("bbox", "media", "report", "llm"):
                d[k] = json.loads(d[k]) if d[k] else None
            d["ts"] = datetime.fromisoformat(d["ts"])
            out.append(d)
        return out

    def event(self, event_id: int) -> dict[str, Any] | None:
        r = self.db.execute("select site_id from events where id=?", (event_id,)).fetchone()
        if not r:
            return None
        return next(e for e in self.events(r["site_id"]) if e["id"] == event_id)

    def clear_site(self, site_id: str) -> None:
        self.db.execute("delete from events where site_id=?", (site_id,))
        self.db.commit()

    def add_rule(self, site_id: str, rule: SuppressRule, source_event_id: int | None = None) -> int:
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

    def delete_rule(self, rule_id: int) -> None:
        self.db.execute("delete from rules where id=?", (rule_id,))
        self.db.commit()
