from synthetic import FLASH, PERSON

from camai.gate import Event, GateConfig, detect
from camai.ingest import FileSource


def test_gate_finds_the_walker_and_logs_the_flash_separately(synthetic_clip):
    src = FileSource(synthetic_clip)
    events = detect(src.iter_gray(fps=4), 4)
    motion = [e for e in events if e.kind == "motion"]
    flashes = [e for e in events if e.kind == "global_change"]
    assert len(motion) == 1
    m = motion[0]
    assert m.start_s <= PERSON[0] + 0.5 and m.end_s >= PERSON[1] - 0.5
    # walker moves through the lower half of the frame
    assert 0.35 < m.bbox[1] < 0.75
    assert len(flashes) == 1 and abs(flashes[0].start_s - FLASH[0]) < 1.0
    # the flash must not be reported as motion
    assert not any(e.start_s <= FLASH[0] <= e.end_s for e in motion)


def test_masked_region_is_ignored(synthetic_clip):
    src = FileSource(synthetic_clip)
    events = detect(src.iter_gray(fps=4), 4, GateConfig(masks=[(0, 0.4, 1, 0.6)]))
    assert [e for e in events if e.kind == "motion"] == []


def test_sample_times_are_ordered_and_inside_event():
    e = Event(10.0, 20.0, (0, 0, 1, 1))
    ts = e.sample_times(8)
    assert len(ts) == 8 and ts == sorted(ts) and 10 < ts[0] and ts[-1] < 20
