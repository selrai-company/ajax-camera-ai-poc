from conftest import FakeBackend
from fastapi.testclient import TestClient

from camai.brief import build_brief
from camai.llm import Claude
from camai.pipeline import process_site
from camai.store import Store
from camai.web import create_app


def _run(site, tmp_path, report=None):
    store = Store(tmp_path / "db.sqlite")
    claude = Claude(FakeBackend(report), None)
    process_site(site, claude, store, tmp_path / "media", log=lambda *_: None)
    return store, claude


def test_pipeline_to_brief_flags_person_at_night(site, tmp_path):
    store, claude = _run(site, tmp_path)
    b = build_brief(site, store, claude)
    assert b["status"] == "needs_look"
    flagged = [e for e in b["events"] if e["severity"] == "needs_look"]
    assert len(flagged) == 1 and flagged[0]["title"] == "Person in yard"
    assert (tmp_path / "media" / flagged[0]["media"]["dir"] / "clip.mp4").exists()
    assert 6 <= len(flagged[0]["media"]["frames"]) <= 16


def test_quiet_night_needs_no_ai_call(site, tmp_path):
    animal = {**FakeBackend().report, "person_present": "no", "activity": "animal", "summary": "A fox crossed."}
    store, claude = _run(site, tmp_path, animal)
    calls_before = len(claude.backend.calls)
    b = build_brief(site, store, claude)
    assert b["status"] == "all_good" and b["headline"].startswith("Quiet night")
    assert len(claude.backend.calls) == calls_before


def test_not_a_problem_quietens_but_never_hides_an_armed_person(site, tmp_path):
    store, claude = _run(site, tmp_path)
    client = TestClient(create_app([site], store, tmp_path / "media", claude))
    b = client.get("/api/sites/test/brief").json()
    ev = next(e for e in b["events"] if e["severity"] == "needs_look")
    assert client.post(f"/api/events/{ev['id']}/not-a-problem").status_code == 403  # no page header
    r = client.post(f"/api/events/{ev['id']}/not-a-problem", headers={"X-Camai": "1"}).json()
    assert "walking through" in r["note"]
    b2 = client.get("/api/sites/test/brief").json()
    assert b2["status"] == "fyi"  # person while armed drops to FYI, never ignored
    rules = client.get("/api/sites/test/rules").json()
    assert len(rules) == 1
    assert client.delete(f"/api/rules/{rules[0]['id']}", headers={"X-Camai": "1"}).status_code == 200
    assert client.get("/api/sites/test/brief").json()["status"] == "needs_look"
    assert client.get("/").status_code == 200


def test_not_a_problem_hides_non_person_events(site, tmp_path):
    vehicle = {**FakeBackend().report, "person_present": "no", "vehicle_present": "yes", "activity": "vehicle_passing"}
    store, claude = _run(site, tmp_path, vehicle)
    client = TestClient(create_app([site], store, tmp_path / "media", claude))
    ev = next(e for e in client.get("/api/sites/test/brief").json()["events"] if e["severity"] == "fyi")
    client.post(f"/api/events/{ev['id']}/not-a-problem", headers={"X-Camai": "1"})
    assert client.get("/api/sites/test/brief").json()["status"] == "all_good"


def test_brief_survives_a_failed_ai_headline(site, tmp_path):
    from camai.llm import LLMError

    store, claude = _run(site, tmp_path)

    class Broken:
        name = "broken"

        def complete_json(self, **kw):
            raise LLMError("CLI timed out")

    b = build_brief(site, store, Claude(Broken(), None))
    assert b["status"] == "needs_look" and b["brief_error"] and "to look at" in b["headline"]


def test_gate_only_rerun_keeps_ai_reports(site, tmp_path):
    store, _ = _run(site, tmp_path)
    process_site(site, None, store, tmp_path / "media", log=lambda *_: None)  # like `process --no-ai`
    reports = [e["report"] for e in store.events("test") if e["kind"] == "motion"]
    assert reports and all(reports)


def test_removed_camera_is_skipped(site, tmp_path):
    store, claude = _run(site, tmp_path)
    site.cameras[0].id = "renamed"
    b = build_brief(site, store, claude)
    assert b["events"] == [] and b["status"] == "all_good"
