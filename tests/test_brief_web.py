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


def test_not_a_problem_button_suppresses_the_event(site, tmp_path):
    store, claude = _run(site, tmp_path)
    client = TestClient(create_app([site], store, tmp_path / "media", claude))
    b = client.get("/api/sites/test/brief").json()
    ev = next(e for e in b["events"] if e["severity"] == "needs_look")
    r = client.post(f"/api/events/{ev['id']}/not-a-problem").json()
    assert "walking through" in r["note"]
    b2 = client.get("/api/sites/test/brief").json()
    assert b2["status"] == "all_good"
    assert client.get("/").status_code == 200
