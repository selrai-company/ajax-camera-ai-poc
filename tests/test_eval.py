import json

from conftest import FakeBackend

from camai.evaluate import run_eval
from camai.llm import Claude
from camai.pipeline import process_site
from camai.store import Store


def test_eval_scores_gate_and_flags_separately(site, tmp_path):
    store = Store(tmp_path / "db.sqlite")
    process_site(site, Claude(FakeBackend(), None), store, tmp_path / "media", log=lambda *_: None)
    labels = tmp_path / "labels" / "test"
    labels.mkdir(parents=True)
    (labels / "cam1.json").write_text(json.dumps({"events": [
        {"start": 5, "end": 12, "what": "person", "should_flag": True},
    ]}))
    out = json.loads(run_eval(site, store, tmp_path / "labels", json_out=True))
    assert out["gate_recall"] == "100% (1/1)" and out["end_to_end_recall"] == "100% (1/1)"
    assert out["false_flags_per_hour"] == 0 and out["ai_person_present_correct"] == "100% (1/1)"
