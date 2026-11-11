"""Severity is decided here, in plain code. The AI describes; the site context decides.

Pure functions with no I/O, so they are cheap to test and easy to explain to a customer.
Every reason carries its source ("ai" or "rule") so the app can show who said what.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from camai.ingest import BBox
from camai.site import Camera, Site

NEEDS_LOOK = "needs_look"
UNCONFIRMED = "unconfirmed"
FYI = "fyi"
GUARD = "guard"
IGNORE = "ignore"
CAMERA_ISSUE = "camera_issue"

RANK = {NEEDS_LOOK: 0, UNCONFIRMED: 1, CAMERA_ISSUE: 2, FYI: 3, GUARD: 4, IGNORE: 5}

ACTIVITY_LABELS = {
    "walking_through": "Walking through",
    "loitering": "Lingering",
    "entering_area": "Entering an area",
    "leaving_area": "Leaving an area",
    "carrying_items": "Carrying items",
    "loading_vehicle": "Loading a vehicle",
    "climbing_fence": "Climbing a fence",
    "forcing_entry": "Forcing entry",
    "handling_equipment": "Handling equipment",
    "patrolling": "Patrolling",
    "tampering_with_camera": "Tampering with a camera",
    "vehicle_arriving": "Vehicle arriving",
    "vehicle_leaving": "Vehicle leaving",
    "vehicle_passing": "Vehicle passing",
    "working": "Working",
    "operating_machinery": "Operating machinery",
    "delivery": "Delivery",
    "animal": "Animal",
    "weather_or_lighting": "Weather or lighting",
    "camera_artifact": "Camera glitch",
    "nothing_visible": "Nothing visible",
    "other": "Other activity",
}

# Activities that need a look while armed whoever is doing them (a guard tag never clears these).
ALWAYS_LOOK = {"climbing_fence", "forcing_entry", "loading_vehicle"}
# Needs a look even when the site is disarmed.
ANYTIME_LOOK = {"tampering_with_camera"}


TAMPER_RE = re.compile(r"\b(tap\w*|cover\w*|spray\w*|block\w*|smash\w*|turn\w* away)\b[^.]{0,50}\bcamera|\bcamera\b[^.]{0,50}\b(taped|covered|sprayed|blocked|smashed)\b", re.I)


def effective_activity(report: dict) -> str:
    """The AI's activity, upgraded to tampering when its own description says a camera was covered."""
    act = report.get("activity", "other")
    text = " ".join([report.get("summary", ""), report.get("movement", ""), report.get("search_text", "")])
    if act != "tampering_with_camera" and TAMPER_RE.search(text):
        return "tampering_with_camera"
    return act


def activity_label(activity: str | None) -> str:
    return ACTIVITY_LABELS.get(activity or "other", (activity or "other").replace("_", " ").capitalize())


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
    reasons: list[dict[str, str]] = field(default_factory=list)

    def labels(self) -> list[str]:
        return [r["label"] for r in self.reasons]


def R(label: str, source: str = "rule") -> dict[str, str]:
    return {"label": label, "source": source}


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
        return Verdict(CAMERA_ISSUE, [R("Camera view blank or covered")])
    if kind == "global_change" and not report:
        return Verdict(IGNORE, [R("Whole-frame lighting change (headlights, IR switch)")])

    report = report or {}
    armed = site.is_armed(ts)
    person = report.get("person_present")
    vehicle = report.get("vehicle_present")
    activity = effective_activity(report)
    uniform = report.get("security_uniform", "cant_tell" if person == "yes" else "no_person")
    people = int(report.get("people_count") or (1 if person == "yes" else 0))
    guards = site.guards
    on_shift = bool(guards and guards.on_shift(ts))

    reasons: list[dict[str, str]] = [R("Site armed" if armed else "Site disarmed (work hours)")]
    if person == "yes":
        reasons.append(R("Person" if people <= 1 else f"{people} people", "ai"))
    if vehicle == "yes":
        types = ", ".join(report.get("vehicle_types") or []) or "Vehicle"
        reasons.append(R(types[:1].upper() + types[1:], "ai"))
    if activity not in ("walking_through", "other", "nothing_visible"):
        reasons.append(R(activity_label(activity), "ai"))
    if report.get("items_carried"):
        reasons.append(R("Carrying items", "ai"))

    zones = [z for z in camera.zones if _overlaps(bbox, z.bbox)]
    restricted = [z for z in zones if z.restricted]
    reasons += [R(f"Restricted zone: {z.name}" if z.restricted else f"Zone: {z.name}") for z in zones]

    if activity in ANYTIME_LOOK:
        return Verdict(NEEDS_LOOK, reasons)

    for rule in rules:
        if rule.matches(camera.id, activity, ts):
            # A rule can quieten a person seen while armed, but never hide them completely.
            if armed and person == "yes":
                return Verdict(UNCONFIRMED, [*reasons, R(f"Site rule: {rule.note or activity_label(activity)}")])
            return Verdict(IGNORE, [R(f"Matches site rule: {rule.note or activity_label(activity)}")])

    if armed and activity == "operating_machinery":
        return Verdict(NEEDS_LOOK, [*reasons, R("Machinery operating while armed")])
    if person == "yes":
        # A rostered guard in security clothing is a patrol, armed or not (shifts start before arming).
        if on_shift and uniform == "yes" and people <= 1 and activity not in ALWAYS_LOOK:
            reasons.insert(1, R("Guard on shift"))
            if camera.checkpoint:
                reasons.append(R(f"Checkpoint: {_checkpoint_name(site, camera)}"))
            return Verdict(GUARD, [*reasons, R("Security clothing", "ai")])
        if not armed:
            return Verdict(FYI if restricted else IGNORE, reasons)
        if activity in ALWAYS_LOOK:
            return Verdict(NEEDS_LOOK, reasons)
        if on_shift:
            reasons.insert(1, R("Guard on shift"))
            if uniform == "yes":
                return Verdict(UNCONFIRMED, [*reasons, R("Security clothing on at least one person", "ai"),
                                             R("Can't confirm everyone is a guard")])
            if uniform == "cant_tell":
                return Verdict(UNCONFIRMED, [*reasons, R("Couldn't see security clothing", "ai")])
            return Verdict(NEEDS_LOOK, [*reasons, R("No security clothing seen", "ai")])
        if uniform == "yes":
            reasons.append(R("Security clothing seen, no guard rostered"))
        return Verdict(NEEDS_LOOK, reasons)
    if vehicle == "yes":
        if armed and activity in ("operating_machinery", "loading_vehicle"):
            return Verdict(NEEDS_LOOK, [*reasons, R("Machinery or loading while armed")])
        return Verdict(FYI if armed else IGNORE, reasons)
    if "cant_tell" in (person, vehicle):
        reasons.append(R("AI couldn't tell what moved", "ai"))
        return Verdict(FYI if armed else IGNORE, reasons)
    return Verdict(IGNORE, [R(f"No person or vehicle ({activity_label(activity).lower()})", "ai")])


def _checkpoint_name(site: Site, camera: Camera) -> str:
    if site.guards:
        for cp in site.guards.checkpoints:
            if cp.id == camera.checkpoint:
                return cp.name
    return camera.checkpoint or ""
