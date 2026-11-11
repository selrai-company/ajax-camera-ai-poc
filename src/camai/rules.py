"""Severity is decided here, in plain code. The AI describes; the site context decides.

Pure functions with no I/O, so they are cheap to test and easy to explain to a customer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from camai.ingest import BBox
from camai.site import Camera, Site

NEEDS_LOOK = "needs_look"
FYI = "fyi"
IGNORE = "ignore"
CAMERA_ISSUE = "camera_issue"


@dataclass
class SuppressRule:
    """A 'Not a problem' rule a customer created. Matches by camera, activity and hour."""

    id: int
    camera_id: str
    activity: str
    hour_from: int
    hour_to: int  # inclusive, may wrap past midnight
    note: str = ""

    def matches(self, camera_id: str, activity: str, ts: datetime) -> bool:
        if camera_id != self.camera_id or activity != self.activity:
            return False
        h = ts.hour
        if self.hour_from <= self.hour_to:
            return self.hour_from <= h <= self.hour_to
        return h >= self.hour_from or h <= self.hour_to


@dataclass
class Verdict:
    severity: str
    reasons: list[str]


def _overlaps(a: BBox, b: BBox) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def evaluate(
    *,
    kind: str,
    report: dict[str, Any] | None,
    bbox: BBox,
    ts: datetime,
    site: Site,
    camera: Camera,
    rules: list[SuppressRule] = (),  # type: ignore[assignment]
) -> Verdict:
    if kind == "blank_view":
        return Verdict(CAMERA_ISSUE, ["Camera view blank or covered"])
    if kind == "global_change" and not report:
        return Verdict(IGNORE, ["Whole-frame lighting change (headlights, IR switch)"])

    report = report or {}
    armed = site.is_armed(ts)
    person = report.get("person_present")
    vehicle = report.get("vehicle_present")
    activity = report.get("activity", "other")
    reasons: list[str] = ["Armed" if armed else "Site disarmed (work hours)"]

    for rule in rules:
        if rule.matches(camera.id, activity, ts):
            # A rule can quieten a person seen while armed, but never hide them completely.
            if armed and person == "yes":
                return Verdict(FYI, [*reasons, f"Site rule: {rule.note or activity}"])
            return Verdict(IGNORE, [f"Matches site rule: {rule.note or activity}"])

    zones = [z for z in camera.zones if _overlaps(bbox, z.bbox)]
    restricted = [z for z in zones if z.restricted]
    reasons += [f"{z.name} zone" for z in zones]

    if person == "yes":
        if armed:
            return Verdict(NEEDS_LOOK, reasons)
        return Verdict(FYI if restricted else IGNORE, reasons)
    if vehicle == "yes":
        return Verdict(FYI if armed else IGNORE, reasons)
    if "cant_tell" in (person, vehicle):
        reasons.append("AI couldn't tell what moved")
        return Verdict(FYI if armed else IGNORE, reasons)
    return Verdict(IGNORE, [f"No person or vehicle ({activity.replace('_', ' ')})"])
