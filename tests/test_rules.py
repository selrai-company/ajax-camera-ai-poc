from datetime import datetime

from camai.rules import CAMERA_ISSUE, FYI, GUARD, IGNORE, NEEDS_LOOK, UNCONFIRMED, SuppressRule, evaluate

NIGHT = datetime(2026, 11, 10, 2, 14)
DAY = datetime(2026, 11, 10, 11, 0)
PERSON = {"person_present": "yes", "vehicle_present": "no", "activity": "walking_through"}
IN_ZONE = (0.55, 0.5, 0.1, 0.1)
OUT_OF_ZONE = (0.0, 0.0, 0.1, 0.1)


def v(site, report, ts=NIGHT, bbox=OUT_OF_ZONE, kind="motion", rules=()):
    return evaluate(kind=kind, report=report, bbox=bbox, ts=ts, site=site, camera=site.cameras[0], rules=list(rules))


def test_armed_window_wraps_midnight(site):
    assert site.is_armed(NIGHT) and site.is_armed(datetime(2026, 11, 10, 19, 0))
    assert not site.is_armed(DAY)


def test_person_while_armed_needs_a_look(site):
    out = v(site, PERSON, bbox=IN_ZONE)
    assert out.severity == NEEDS_LOOK and "Site armed" in out.labels() and "Restricted zone: Tool container" in out.labels()
    assert {"label": "Person", "source": "ai"} in out.reasons


def test_person_in_work_hours_is_ignored_unless_restricted_zone(site):
    assert v(site, PERSON, ts=DAY).severity == IGNORE
    assert v(site, PERSON, ts=DAY, bbox=IN_ZONE).severity == FYI


def test_vehicle_and_cant_tell_are_fyi_at_night(site):
    assert v(site, {"person_present": "no", "vehicle_present": "yes", "activity": "vehicle_passing"}).severity == FYI
    assert v(site, {"person_present": "cant_tell", "vehicle_present": "no", "activity": "other"}).severity == FYI


def test_animals_and_weather_are_ignored(site):
    out = v(site, {"person_present": "no", "vehicle_present": "no", "activity": "animal"})
    assert out.severity == IGNORE and "animal" in out.labels()[0]


def test_not_a_problem_rule_suppresses_matching_events_only(site):
    rule = SuppressRule(1, "cam1", "walking_through", 1, 3, "cleaner")
    assert v(site, PERSON, rules=[rule]).severity == UNCONFIRMED  # armed person: quietened, never hidden
    day_rule = SuppressRule(3, "cam1", "walking_through", 10, 12, "")
    assert v(site, PERSON, ts=DAY, bbox=IN_ZONE, rules=[day_rule]).severity == IGNORE
    assert v(site, {**PERSON, "activity": "carrying_items"}, rules=[rule]).severity == NEEDS_LOOK
    wrap = SuppressRule(2, "cam1", "walking_through", 23, 1, "")
    assert wrap.matches("cam1", "walking_through", datetime(2026, 1, 1, 0, 30))


def test_camera_signals(site):
    assert v(site, None, kind="blank_view").severity == CAMERA_ISSUE
    assert v(site, None, kind="global_change").severity == IGNORE
    # a long whole-frame change that the AI looked at (someone close to the lens) is judged normally
    assert v(site, PERSON, kind="global_change").severity == NEEDS_LOOK


def test_guard_logic(guarded_site):
    s = guarded_site
    guard = {**PERSON, "security_uniform": "yes"}
    assert v(s, guard).severity == GUARD
    assert v(s, guard, ts=datetime(2026, 11, 10, 18, 30)).severity == GUARD  # shift starts before or at arming
    assert v(s, {**guard, "people_count": 2}).severity == UNCONFIRMED  # a guard never clears a second person
    assert v(s, {**PERSON, "security_uniform": "cant_tell"}).severity == UNCONFIRMED
    assert v(s, {**PERSON, "security_uniform": "no"}).severity == NEEDS_LOOK
    assert v(s, {**guard, "activity": "climbing_fence"}).severity == NEEDS_LOOK  # never cleared by a vest


def test_vest_without_roster_is_still_a_look(site):
    out = v(site, {**PERSON, "security_uniform": "yes"})
    assert out.severity == NEEDS_LOOK and "Security clothing seen, no guard rostered" in out.labels()


def test_tampering_any_time_and_machinery_while_armed(site):
    tamper = {**PERSON, "activity": "handling_equipment", "summary": "A person reaches up and tapes over the camera."}
    assert v(site, tamper, ts=DAY).severity == NEEDS_LOOK
    plant = {"person_present": "no", "vehicle_present": "yes", "vehicle_types": ["excavator"], "activity": "operating_machinery"}
    assert v(site, plant).severity == NEEDS_LOOK and v(site, plant, ts=DAY).severity == IGNORE
