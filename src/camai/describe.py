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
    "climbing_fence",
    "forcing_entry",
    "handling_equipment",
    "patrolling",
    "tampering_with_camera",
    "vehicle_arriving",
    "vehicle_leaving",
    "vehicle_passing",
    "working",
    "operating_machinery",
    "delivery",
    "animal",
    "weather_or_lighting",
    "camera_artifact",
    "nothing_visible",
    "other",
]

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
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
        "security_uniform": {"type": "string", "enum": ["yes", "no", "cant_tell", "no_person"]},
        "hi_vis": {"type": "string", "enum": ["yes", "no", "cant_tell", "no_person"]},
        "search_text": {"type": "string"},
        "key_moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"frame": {"type": "integer"}, "label": {"type": "string"}},
                "required": ["frame", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "title", "summary", "person_present", "people_count", "vehicle_present", "vehicle_types",
        "activity", "items_carried", "movement", "cant_tell", "confidence", "evidence_frames",
        "security_uniform", "hi_vis", "search_text", "key_moments",
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
- title: 4 to 9 words saying what happened, sentence case, no camera name or time (e.g. "Person climbs fence and crosses the yard").
- summary: one plain-English sentence a site manager can read in five seconds.
- evidence_frames: the frame numbers that best show what happened.
- security_uniform: "yes" only if a person visibly wears security clothing (for example a vest or jacket marked SECURITY) or carries guard kit such as a torch while patrolling; "cant_tell" if a person is there but too dark or far to see; "no_person" if nobody is visible. This is a visual cue only; never assume someone is a guard from behaviour alone.
- If someone covers, tapes, sprays, moves or damages a camera, use activity "tampering_with_camera".
- key_moments: 1 to 3 moments worth jumping to, each a frame number and a 2 to 6 word label of what happens in that frame (e.g. {"frame": 4, "label": "Climbs over the fence"}). Empty if nothing happens.
- hi_vis: whether a visible person wears high-visibility work clothing ("no_person" if nobody is visible).
- search_text: 15-40 plain words listing every concrete thing visible, for later search: vehicle types and colours (ute, tipper truck, excavator, skid steer), machinery, tools, materials, containers, fences, gates, ladders, torches, clothing such as hi-vis, and actions. No full sentences, no guesses about identity."""


def _zoom_box(box, pad: float = 0.8, min_size: float = 0.3):
    x, y, w, h = box
    w2, h2 = max(w * (1 + 2 * pad), min_size), max(h * (1 + 2 * pad), min_size)
    cx, cy = x + w / 2, y + h / 2
    x2, y2 = min(max(0.0, cx - w2 / 2), 1 - min(w2, 1)), min(max(0.0, cy - h2 / 2), 1 - min(h2, 1))
    return (x2, y2, min(w2, 1 - x2), min(h2, 1 - y2))


def describe_event(
    claude: Claude,
    src: FileSource,
    event: Event,
    clip_start: datetime,
    media_dir: Path,
    n_frames: int | None = None,
    model: str = HAIKU,
    blackout: list = (),
    width: int = 768,
    prefix: str = "",
    effort: str = "low",
    zoom: bool = False,
) -> tuple[dict, LLMResult, dict]:
    """Returns (report, llm_result, media paths)."""
    media_dir.mkdir(parents=True, exist_ok=True)
    images: list[Image] = []
    frames: list[str] = []
    # About one frame every 2.5 s, 6 to 16 frames: short events stay cheap, long ones don't skip a walk-past.
    n = n_frames or max(6, min(16, round(event.duration_s / 2.5)))
    times = event.sample_times(n)
    for i, t in enumerate(times, 1):
        p = src.grab(t, media_dir / f"{prefix}frame_{i:02d}.jpg", max_width=width, blackout=blackout)
        frames.append(p.name)
        wall = clip_start + timedelta(seconds=t)
        label = f"Frame {i} of {len(times)}, {wall.strftime('%H:%M:%S')}"
        images.append(Image.from_path(p, label))
        if zoom and event.track:
            # Spatial zoom: a close-up around where the motion is in this frame.
            tt, box = min(event.track, key=lambda tb: abs(tb[0] - t))
            if abs(tt - t) <= 1.5:
                zb = _zoom_box(box)
                z = src.grab(t, media_dir / f"{prefix}zoom_{i:02d}.jpg", crop=zb, max_width=width, blackout=blackout)
                images.append(Image.from_path(z, f"Frame {i} close-up of the moving area"))
    crop = src.grab(
        event.peak_s, media_dir / f"{prefix}crop_peak.jpg", crop=event.peak_bbox or event.bbox, max_width=width,
        blackout=blackout
    )
    images.append(Image.from_path(crop, "Close-up crop of the motion area at its busiest moment"))

    res = claude.complete_json(
        model=model,
        system=SYSTEM,
        images=images,
        text="Describe this event as JSON matching the schema.",
        schema=REPORT_SCHEMA,
        effort=effort,
        max_tokens=12000,  # includes thinking tokens
    )
    moments = []
    for m in res.data.get("key_moments") or []:
        if 1 <= int(m.get("frame", 0)) <= len(times):
            moments.append({"t": round(times[int(m["frame"]) - 1] - event.start_s, 2), "label": str(m.get("label", ""))[:60]})
    track = [{"t": round(t - event.start_s, 2), "box": list(b)} for t, b in event.track]
    return res.data, res, {"frames": frames, "crop": crop.name, "moments": moments, "track": track,
                           "frame_times": [round(t - event.start_s, 2) for t in times]}
