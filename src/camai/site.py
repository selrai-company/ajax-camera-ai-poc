"""Site configuration from YAML: cameras and their recordings, armed hours, zones, guards,
lock-up checks and (simulated) alarm events.

Plug-in points for the real product:
- recordings come from files today; an RTSP recorder writes the same (file, start) pairs.
- `armed` hours stand in for Ajax arming state (`ArmingProvider` in INTEGRATION.md).
- `alarms` stand in for the Ajax Enterprise API alarm feed (`AlarmFeed`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from camai.ingest import BBox


@dataclass
class Zone:
    name: str
    bbox: BBox
    restricted: bool = False


@dataclass
class Recording:
    file: Path
    start: datetime  # local wall-clock time of the first frame


@dataclass
class Camera:
    id: str
    name: str
    recordings: list[Recording]
    zones: list[Zone] = field(default_factory=list)
    masks: list[BBox] = field(default_factory=list)
    checkpoint: str | None = None  # guard checkpoint id this camera covers

    # Backwards-compatible accessors for single-recording cameras
    @property
    def file(self) -> Path:
        return self.recordings[0].file

    @property
    def start(self) -> datetime:
        return self.recordings[0].start

    def at(self, seconds: float, rec: Recording | None = None) -> datetime:
        return (rec or self.recordings[0]).start + timedelta(seconds=seconds)


@dataclass
class Checkpoint:
    id: str
    name: str
    camera_id: str


@dataclass
class Guards:
    shift_from: time
    shift_to: time
    checkpoints: list[Checkpoint]
    rounds: list[time]  # scheduled round start times
    round_window_min: int = 45  # a checkpoint visit counts for a round within this many minutes after it starts
    phone: str | None = None  # "Call guard" number (demo: placeholder)

    def on_shift(self, ts: datetime) -> bool:
        return _in_window(ts.time(), self.shift_from, self.shift_to)


@dataclass
class LockupCheckConfig:
    camera_id: str
    question: str
    expect: str  # "yes" or "no": the answer that means locked up
    kind: str = "lockup"  # lockup | perimeter


@dataclass
class AssetConfig:
    camera_id: str
    asset: str  # "Excavator"
    question: str  # "Is the yellow excavator parked in the compound?"


@dataclass
class AlarmConfig:
    at: datetime
    zone: str
    camera_id: str


@dataclass
class Site:
    id: str
    name: str
    armed_from: time
    armed_to: time
    cameras: list[Camera]
    notes: str = ""
    timezone: str = "Australia/Sydney"
    address_hint: str | None = None
    guards: Guards | None = None
    lockup_at: time | None = None
    lockup_checks: list[LockupCheckConfig] = field(default_factory=list)
    assets: list[AssetConfig] = field(default_factory=list)
    morning_at: time | None = None  # when the morning asset check runs (defaults to the end of the armed window)
    alarms: list[AlarmConfig] = field(default_factory=list)
    replay_start: datetime | None = None
    demo: bool = True

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def all_day(self) -> bool:
        return self.armed_from == self.armed_to

    def is_armed(self, ts: datetime) -> bool:
        """Armed window may cross midnight (e.g. 18:00 to 06:00). Equal times = armed all day."""
        if self.all_day:
            return True
        return _in_window(ts.time(), self.armed_from, self.armed_to)

    def camera(self, camera_id: str) -> Camera:
        return next(c for c in self.cameras if c.id == camera_id)

    def has_camera(self, camera_id: str) -> bool:
        return any(c.id == camera_id for c in self.cameras)

    def iso(self, ts: datetime) -> str:
        """Local naive time -> ISO string with the site's UTC offset."""
        return ts.replace(tzinfo=self.tz).isoformat()


def _in_window(t: time, start: time, end: time) -> bool:
    if start == end:
        return True
    if start < end:
        return start <= t < end
    return t >= start or t < end


def night_of(ts: datetime) -> date:
    """A night is named by the date it starts: anything before noon belongs to the previous night."""
    return (ts - timedelta(hours=12)).date()


def night_window(night: date) -> tuple[datetime, datetime]:
    start = datetime.combine(night, time(12, 0))
    return start, start + timedelta(days=1)


def _t(s: str) -> time:
    return datetime.strptime(str(s), "%H:%M").time()


def _path(base: Path, f: str) -> Path:
    p = Path(f)
    return p if p.is_absolute() else (base / p).resolve()


def load_site(path: Path) -> Site:
    path = Path(path)
    d = yaml.safe_load(path.read_text())
    cams = []
    for c in d["cameras"]:
        if "recordings" in c:
            recs = [Recording(_path(path.parent, r["file"]), datetime.fromisoformat(str(r["start"])))
                    for r in c["recordings"]]
        else:
            recs = [Recording(_path(path.parent, c["file"]), datetime.fromisoformat(str(c["start"])))]
        cams.append(
            Camera(
                id=c["id"],
                name=c.get("name", c["id"]),
                recordings=sorted(recs, key=lambda r: r.start),
                zones=[Zone(z["name"], tuple(z["bbox"]), bool(z.get("restricted", False))) for z in c.get("zones", [])],
                masks=[tuple(m) for m in c.get("masks", [])],
                checkpoint=c.get("checkpoint"),
            )
        )
    guards = None
    if g := d.get("guards"):
        guards = Guards(
            shift_from=_t(g["shift"]["from"]),
            shift_to=_t(g["shift"]["to"]),
            checkpoints=[Checkpoint(cp["id"], cp["name"], cp["camera"]) for cp in g.get("checkpoints", [])],
            rounds=[_t(r) for r in g.get("rounds", [])],
            round_window_min=int(g.get("round_window_min", 45)),
            phone=g.get("phone"),
        )
    lock = d.get("lockup") or {}
    return Site(
        id=d["id"],
        name=d["name"],
        armed_from=_t(d["armed"]["from"]),
        armed_to=_t(d["armed"]["to"]),
        cameras=cams,
        notes=d.get("notes", ""),
        timezone=d.get("timezone", "Australia/Sydney"),
        address_hint=d.get("address_hint"),
        guards=guards,
        lockup_at=_t(lock["at"]) if lock.get("at") else None,
        lockup_checks=[LockupCheckConfig(c["camera"], c["question"], c.get("expect", "yes"), c.get("kind", "lockup"))
                       for c in lock.get("checks", [])],
        assets=[AssetConfig(a["camera"], a["asset"], a["question"]) for a in d.get("assets", [])],
        morning_at=_t(d["morning_at"]) if d.get("morning_at") else None,
        alarms=[AlarmConfig(datetime.fromisoformat(str(a["at"])), a["zone"], a["camera"]) for a in d.get("alarms", [])],
        replay_start=datetime.fromisoformat(str(d["replay_start"])) if d.get("replay_start") else None,
        demo=bool(d.get("demo", True)),
    )
