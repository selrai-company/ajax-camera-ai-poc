from conftest import PERSON_REPORT, FakeBackend
from fastapi.testclient import TestClient

from camai.api import create_app
from camai.llm import Claude, LLMError
from camai.pipeline import process_site
from camai.store import Store

H = {"X-Camai": "1"}


def _app(site, tmp_path, report=None, claude=None):
    store = Store(tmp_path / "db.sqlite")
    claude = claude or Claude(FakeBackend(report), None)
    process_site(site, claude, store, tmp_path / "media", log=lambda *_: None)
    return TestClient(create_app([site], store, tmp_path / "media", claude)), store, claude


def test_sites_wall_and_annotations(site, tmp_path):
    c, _, _ = _app(site, tmp_path)
    s = c.get("/api/v1/sites").json()[0]
    assert s["id"] == "test" and s["default_night"] == "2026-11-09" and s["armed"]["from"] == "18:00"
    w = c.get("/api/v1/sites/test/wall").json()
    assert w["cameras"][0]["segments"] and w["cameras"][0]["poster"].endswith(".jpg")
    ev = next(e for e in w["events"] if e["kind"] == "motion")
    assert ev["severity"] == "needs_look" and ev["start"].endswith("+11:00")
    assert ev["track"] and 0 <= ev["track"][0]["box"][0] <= 1  # where the movement is, over time
    assert ev["moments"] and ev["moments"][0]["label"] == "Walks past the container"
    assert {r["source"] for r in ev["reasons"]} == {"ai", "rule"}
    assert w["incidents"] and w["incidents"][0]["headline_by"] == "ai"


def test_incident_detail_brief_and_evidence(site, tmp_path):
    c, _, _ = _app(site, tmp_path)
    b = c.get("/api/v1/sites/test/brief").json()
    assert b["status"] == "needs_look" and b["incidents"]
    for key in ("deliveries", "assets", "repeat_vehicles", "suggestions", "lockup"):
        assert key in b
    inc = c.get(f"/api/v1/incidents/{b['incidents'][0]['id']}").json()
    assert inc["events"] and inc["why"]
    pdf = c.get(f"/api/v1/incidents/{inc['id']}/evidence.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert c.post(f"/api/v1/incidents/{inc['id']}/status", json={"status": "handled"}).status_code == 403
    assert c.post(f"/api/v1/incidents/{inc['id']}/status", json={"status": "handled"}, headers=H).json()["status"] == "handled"


def test_dismiss_just_this_event_then_rule_preview_and_create(site, tmp_path):
    vehicle = {**PERSON_REPORT, "person_present": "no", "vehicle_present": "yes", "vehicle_types": ["white ute"],
               "activity": "vehicle_passing", "security_uniform": "no_person"}
    c, store, _ = _app(site, tmp_path, vehicle)
    ev = next(e for e in c.get("/api/v1/sites/test/wall").json()["events"] if e["kind"] == "motion")
    assert ev["severity"] == "fyi"
    d = c.post(f"/api/v1/events/{ev['id']}/dismiss", headers=H).json()
    assert d["dismissed"] and d["severity"] == "ignore"
    prev = c.get(f"/api/v1/events/{ev['id']}/rule-preview").json()
    assert "vehicle passing" in prev["description"] and prev["would_hide"] >= 1 and prev["caveat"] is None
    rule = c.post("/api/v1/rules", json={"event_id": ev["id"]}, headers=H).json()
    assert c.get("/api/v1/sites/test/rules").json()[0]["id"] == rule["id"]
    assert c.delete(f"/api/v1/rules/{rule['id']}", headers=H).json() == {"ok": True}


def test_rule_never_hides_an_armed_person(site, tmp_path):
    c, _, _ = _app(site, tmp_path)
    ev = next(e for e in c.get("/api/v1/sites/test/wall").json()["events"] if e["kind"] == "motion")
    prev = c.get(f"/api/v1/events/{ev['id']}/rule-preview").json()
    assert prev["caveat"]
    c.post("/api/v1/rules", json={"event_id": ev["id"]}, headers=H)
    ev2 = next(e for e in c.get("/api/v1/sites/test/wall").json()["events"] if e["id"] == ev["id"])
    assert ev2["severity"] == "unconfirmed"


def test_search_answers_with_citations_and_identity_note(site, tmp_path):
    c, _, _ = _app(site, tmp_path)
    r = c.post("/api/v1/search", json={"site_id": "test", "q": "people in the yard"}).json()
    assert r["results"] and r["answer"].startswith("A person") and "[#" in r["answer"]
    assert r["results"][0]["checked_on_frames"] and r["results"][0]["frame_check"] == "confirmed"
    who = c.post("/api/v1/search", json={"site_id": "test", "q": "who was in the yard"}).json()
    assert "doesn't identify people" in who["note"]


def test_guard_patrol_counts_and_never_clears_two_people(guarded_site, tmp_path):
    guard = {**PERSON_REPORT, "security_uniform": "yes", "activity": "patrolling"}
    c, _, _ = _app(guarded_site, tmp_path, guard)
    ev = next(e for e in c.get("/api/v1/sites/test/wall").json()["events"] if e["kind"] == "motion")
    assert ev["severity"] == "guard"
    p = c.get("/api/v1/sites/test/patrols").json()
    assert p["rounds"][0]["visits"]["yard"]["status"] == "visited" and p["coverage_pct"] == 100
    assert "not who visited" in p["privacy_note"]


def test_brief_survives_a_failed_ai_headline(site, tmp_path):
    c, store, _ = _app(site, tmp_path)

    class Broken:
        name = "broken"

        def complete_json(self, **kw):
            raise LLMError("CLI timed out")

    c2 = TestClient(create_app([site], store, tmp_path / "media", Claude(Broken(), None)))
    b = c2.get("/api/v1/sites/test/brief").json()
    assert b["status"] == "needs_look" and b["headline_by"] == "rule"


def test_portfolio_ranks_sites(site, tmp_path):
    c, _, _ = _app(site, tmp_path)
    rows = c.get("/api/v1/portfolio").json()
    assert rows[0]["site"]["id"] == "test" and rows[0]["open_incidents"] >= 1 and "incident" in rows[0]["rank_reason"]


def test_gate_only_rerun_keeps_ai_reports(site, tmp_path):
    _, store, _ = _app(site, tmp_path)
    process_site(site, None, store, tmp_path / "media", log=lambda *_: None)
    assert all(e["report"] for e in store.events("test") if e["kind"] == "motion")


def test_patrol_gap_with_several_visits_and_serious_gap_reaches_brief(guarded_site, tmp_path):
    """Two guard visits used to crash the gap check (sorting dicts); a 6h+ gap must reach the brief."""
    from datetime import datetime, time

    from camai.patrols import compute
    from camai.site import Camera, Recording

    guard = {**PERSON_REPORT, "security_uniform": "yes", "activity": "patrolling"}
    clip = guarded_site.cameras[0].recordings[0].file
    # a second recording of the checkpoint camera 3 minutes later -> two guard visits in one shift
    guarded_site.cameras[0].recordings.append(Recording(clip, datetime(2026, 11, 10, 2, 17)))
    # a non-checkpoint camera with a guard sighting must not close a checkpoint gap
    guarded_site.cameras.append(Camera(id="cam2", name="Lunch room", recordings=[Recording(clip, datetime(2026, 11, 10, 22, 0))]))
    guarded_site.guards.shift_from, guarded_site.guards.shift_to = time(18, 0), time(6, 0)
    c, store, _ = _app(guarded_site, tmp_path, guard)
    p = compute(guarded_site, store, datetime(2026, 11, 9).date())
    gap = next(i for i in p["insights"] if i["text"].startswith("No checkpoint visited"))
    assert gap["severity"] == "needs_look" and "6:00pm to 2:14am" in gap["text"]  # cam2 at 10pm doesn't count
    b = c.get("/api/v1/sites/test/brief").json()
    assert any(x["severity"] == "needs_look" for x in b["patrol"]["missed"]) and b["status"] == "needs_look"
