"""Haiku describes what happened in an event, from ordered frames plus a close-up crop.

It describes behaviour only. It never identifies people, guesses age, gender or
ethnicity, or judges intent. "Can't tell" is always an allowed answer.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from camai.gate import Event
from camai.ingest import FileSource
from camai.llm import HAIKU, Claude, Image, LLMResult

ACTIVITIES = [
    "walking_through",
    "loitering",
    "entering_area",
    "leaving_area",
    "carrying_items",
    "loading_vehicle",
    "vehicle_arriving",
    "vehicle_leaving",
    "vehicle_passing",
    "working",
    "animal",
    "weather_or_lighting",
    "camera_artifact",
    "nothing_visible",
    "other",
]

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "person_present": {"type": "string", "enum": ["yes", "no", "cant_tell"]},
        "people_count": {"type": "integer"},
        "vehicle_present": {"type": "string", "enum": ["yes", "no", "cant_tell"]},
        "vehicle_types": {"type": "array", "items": {"type": "string"}},
        "activity": {"type": "string", "enum": ACTIVITIES},
        "items_carried": {"type": "array", "items": {"type": "string"}},
        "movement": {"type": "string"},
        "cant_tell": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "evidence_frames": {"type": "array", "items": {"type": "integer"}},
    },
    "required": [
        "summary", "person_present", "people_count", "vehicle_present", "vehicle_types",
        "activity", "items_carried", "movement", "cant_tell", "confidence", "evidence_frames",
    ],
    "additionalProperties": False,
}

SYSTEM = """You review security camera footage for job sites (construction sites, yards, depots).
You get numbered frames from one camera in time order, then close-up crops of the area where motion was detected.

Describe only what is visible:
- Say what moved: people, vehicles, animals, weather, lighting changes or camera artefacts (noise, insects, rain on the lens).
- Describe actions and movement in order: where they came from, what they did, where they went, and anything carried.
- Never identify anyone. Refer to people only as "a person", "two people" or "person 1/person 2": never "man", "woman", "boy", "girl", "guy" or "lady", and never guess age, ethnicity or other personal traits. Clothing is fine only when it matters to the event (for example a hi-vis vest).
- Ignore any date or time text burned into the picture by the camera. Use only the times in the frame labels.
- Never judge intent or call anything suspicious, criminal or dodgy. Severity is decided elsewhere.
- Night and infrared footage is grainy. When you cannot tell, say so in cant_tell and use "cant_tell" values rather than guessing.
- summary: one plain-English sentence a site manager can read in five seconds.
- evidence_frames: the frame numbers that best show what happened."""


def describe_event(
    claude: Claude,
    src: FileSource,
    event: Event,
    clip_start: datetime,
    media_dir: Path,
    n_frames: int | None = None,
    model: str = HAIKU,
    blackout: list = (),
) -> tuple[dict, LLMResult, dict]:
    """Returns (report, llm_result, media paths)."""
    media_dir.mkdir(parents=True, exist_ok=True)
    images: list[Image] = []
    frames: list[str] = []
    # About one frame every 2.5 s, 6 to 16 frames: short events stay cheap, long ones don't skip a walk-past.
    n = n_frames or max(6, min(16, round(event.duration_s / 2.5)))
    times = event.sample_times(n)
    for i, t in enumerate(times, 1):
        p = src.grab(t, media_dir / f"frame_{i:02d}.jpg", max_width=768, blackout=blackout)
        frames.append(p.name)
        wall = clip_start + timedelta(seconds=t)
        label = f"Frame {i} of {len(times)}, {wall.strftime('%H:%M:%S')}"
        images.append(Image.from_path(p, label))
    crop = src.grab(
        event.peak_s, media_dir / "crop_peak.jpg", crop=event.peak_bbox or event.bbox, max_width=768, blackout=blackout
    )
    images.append(Image.from_path(crop, "Close-up crop of the motion area at its busiest moment"))

    res = claude.complete_json(
        model=model,
        system=SYSTEM,
        images=images,
        text="Describe this event as JSON matching the schema.",
        schema=REPORT_SCHEMA,
        effort="low",
        max_tokens=8000,  # includes thinking tokens
    )
    return res.data, res, {"frames": frames, "crop": crop.name}
