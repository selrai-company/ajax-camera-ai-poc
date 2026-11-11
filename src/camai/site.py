"""Site configuration: cameras, armed hours and zones, loaded from a YAML file."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from pathlib import Path

import yaml

from camai.ingest import BBox


@dataclass
class Zone:
    name: str
    bbox: BBox
    restricted: bool = False


@dataclass
class Camera:
    id: str
    name: str
    file: Path
    start: datetime  # wall-clock time of the first frame of the recording
    zones: list[Zone] = field(default_factory=list)
    masks: list[BBox] = field(default_factory=list)

    def at(self, seconds: float) -> datetime:
        return self.start + timedelta(seconds=seconds)


@dataclass
class Site:
    id: str
    name: str
    armed_from: time
    armed_to: time
    cameras: list[Camera]
    notes: str = ""

    def is_armed(self, ts: datetime) -> bool:
        """Armed window may cross midnight (e.g. 18:00 to 06:00). Equal times = armed all day."""
        t = ts.time()
        if self.armed_from == self.armed_to:
            return True
        if self.armed_from < self.armed_to:
            return self.armed_from <= t < self.armed_to
        return t >= self.armed_from or t < self.armed_to

    def camera(self, camera_id: str) -> Camera:
        return next(c for c in self.cameras if c.id == camera_id)


def _t(s: str) -> time:
    return datetime.strptime(str(s), "%H:%M").time()


def load_site(path: Path) -> Site:
    path = Path(path)
    d = yaml.safe_load(path.read_text())
    cams = []
    for c in d["cameras"]:
        f = Path(c["file"])
        cams.append(
            Camera(
                id=c["id"],
                name=c.get("name", c["id"]),
                file=f if f.is_absolute() else (path.parent / f).resolve(),
                start=datetime.fromisoformat(str(c["start"])),
                zones=[Zone(z["name"], tuple(z["bbox"]), bool(z.get("restricted", False))) for z in c.get("zones", [])],
                masks=[tuple(m) for m in c.get("masks", [])],
            )
        )
    return Site(
        id=d["id"],
        name=d["name"],
        armed_from=_t(d["armed"]["from"]),
        armed_to=_t(d["armed"]["to"]),
        cameras=cams,
        notes=d.get("notes", ""),
    )
