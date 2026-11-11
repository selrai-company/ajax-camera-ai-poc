import re
from datetime import datetime, time
from pathlib import Path

import pytest
from synthetic import make_clip

from camai.llm import LLMResult
from camai.site import Camera, Checkpoint, Guards, Recording, Site, Zone


@pytest.fixture(scope="session")
def synthetic_clip(tmp_path_factory) -> Path:
    return make_clip(tmp_path_factory.mktemp("clip") / "syn.mp4")


@pytest.fixture
def site(synthetic_clip) -> Site:
    cam = Camera(
        id="cam1", name="Yard", recordings=[Recording(synthetic_clip, datetime(2026, 11, 10, 2, 14))],
        zones=[Zone("Tool container", (0.5, 0.4, 0.3, 0.4), restricted=True)],
    )
    return Site(id="test", name="Test yard", armed_from=time(18, 0), armed_to=time(6, 0), cameras=[cam])


@pytest.fixture
def guarded_site(site) -> Site:
    site.cameras[0].checkpoint = "yard"
    site.guards = Guards(shift_from=time(18, 0), shift_to=time(6, 0), checkpoints=[Checkpoint("yard", "Yard", "cam1")],
                         rounds=[time(2, 0)], round_window_min=45)
    return site


PERSON_REPORT = {
    "title": "Person walks across the yard",
    "summary": "One person walked left to right across the yard.",
    "person_present": "yes", "people_count": 1, "vehicle_present": "no", "vehicle_types": [],
    "activity": "walking_through", "items_carried": [], "movement": "Entered left, left right.",
    "cant_tell": [], "confidence": "medium", "evidence_frames": [2, 3],
    "security_uniform": "no", "hi_vis": "no", "search_text": "person walking yard container",
    "key_moments": [{"frame": 2, "label": "Walks past the container"}],
}


class FakeBackend:
    """Stands in for Claude: returns canned JSON keyed by which schema was asked for."""

    name = "fake"

    def __init__(self, report=None):
        self.calls = []
        self.report = report or dict(PERSON_REPORT)

    def complete_json(self, *, model, system, content, schema, effort, max_tokens):
        self.calls.append({"model": model, "content": content, "schema": schema})
        props = schema["properties"]
        text = content[-1]["text"] if content else ""
        if "matches" in props:  # search re-rank
            ids = [int(x) for x in re.findall(r'"event_id": (\d+)', text)]
            data = {"answer": f"A person walked across the yard [#{ids[0]}]." if ids else "No matching recorded events.",
                    "matches": [{"event_id": i, "why": "Matches: person in the yard", "highlights": ["person"]} for i in ids[:3]]}
        elif "asks_identity" in props:  # search interpretation
            data = {"cameras": [], "start_time": "", "end_time": "", "subjects": ["person"], "keywords": ["person", "yard"],
                    "summary": "People in the yard", "asks_identity": "who" in text.lower()}
        elif "headline" in props:
            data = {"headline": "At 2:14am a person walked across the Yard camera while the site was armed."}
        elif "answer" in props:
            data = {"answer": "yes", "confidence": "high", "why": "Clearly visible"}
        else:
            data = self.report
        return LLMResult(data=data, model=model, input_tokens=5000, output_tokens=200, backend="fake")
