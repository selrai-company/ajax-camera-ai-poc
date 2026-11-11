from datetime import datetime
from pathlib import Path

import pytest
from synthetic import make_clip

from camai.llm import LLMResult
from camai.site import Camera, Site, Zone


@pytest.fixture(scope="session")
def synthetic_clip(tmp_path_factory) -> Path:
    return make_clip(tmp_path_factory.mktemp("clip") / "syn.mp4")


@pytest.fixture
def site(synthetic_clip) -> Site:
    cam = Camera(
        id="cam1", name="Yard", file=synthetic_clip, start=datetime(2026, 11, 10, 2, 14),
        zones=[Zone("Tool container", (0.5, 0.4, 0.3, 0.4), restricted=True)],
    )
    return Site(id="test", name="Test yard", armed_from=datetime.strptime("18:00", "%H:%M").time(),
                armed_to=datetime.strptime("06:00", "%H:%M").time(), cameras=[cam])


class FakeBackend:
    """Stands in for Claude: returns canned JSON keyed by which schema was asked for."""

    name = "fake"

    def __init__(self, report=None):
        self.calls = []
        self.report = report or {
            "summary": "One person walked left to right across the yard.",
            "person_present": "yes", "people_count": 1, "vehicle_present": "no", "vehicle_types": [],
            "activity": "walking_through", "items_carried": [], "movement": "Entered left, left right.",
            "cant_tell": [], "confidence": "medium", "evidence_frames": [2, 3],
        }

    def complete_json(self, *, model, system, content, schema, effort, max_tokens):
        self.calls.append({"model": model, "content": content, "schema": schema})
        props = schema["properties"]
        if "headline" in props:
            ids = [int(x) for x in __import__("re").findall(r'"event_id": (\d+)', content[-1]["text"])]
            data = {"headline": "A person was in the yard while armed.",
                    "items": [{"event_id": i, "title": "Person in yard"} for i in ids]}
        elif "answer" in props:
            data = {"answer": "yes", "confidence": "high", "why": "Gate visibly open"}
        else:
            data = self.report
        return LLMResult(data=data, model=model, input_tokens=5000, output_tokens=200, backend="fake")
