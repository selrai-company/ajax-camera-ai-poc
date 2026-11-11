"""Motion gate: turns hours of footage into a handful of event windows. No AI.

Grayscale frames are compared with a slowly-updating background. Blobs that persist
for a few frames open an event; a few quiet seconds close it. Whole-frame changes
(IR switching, headlight sweeps, exposure jumps) are logged separately as
``global_change`` because they are not motion, but they are a camera-health signal.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

import cv2
import numpy as np

from camai.ingest import BBox


@dataclass
class GateConfig:
    diff_threshold: int = 22  # grey levels a pixel must change by
    min_blob_frac: float = 0.0012  # smallest blob, as a fraction of the frame
    persist_frames: int = 2  # blob must persist this many sampled frames
    quiet_s: float = 3.0  # this much stillness closes an event
    pre_roll_s: float = 2.0
    post_roll_s: float = 2.0
    merge_gap_s: float = 4.0  # events closer than this are merged
    min_event_s: float = 1.0
    global_frac: float = 0.45  # more than this changed at once = global change
    bg_alpha: float = 0.04  # background learning rate
    blank_std: float = 5.0  # frame std below this looks blank / covered
    blank_min_s: float = 20.0
    masks: list[BBox] = field(default_factory=list)  # e.g. timestamp overlay


@dataclass
class Event:
    start_s: float
    end_s: float
    bbox: BBox
    kind: str = "motion"  # motion | global_change | blank_view
    peak_s: float = 0.0
    peak_area_frac: float = 0.0

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s

    def sample_times(self, n: int = 8) -> list[float]:
        if n <= 1:
            return [self.peak_s or (self.start_s + self.end_s) / 2]
        a, b = self.start_s + 0.25, max(self.start_s + 0.3, self.end_s - 0.25)
        return [round(a + (b - a) * i / (n - 1), 2) for i in range(n)]


def _mask_array(shape: tuple[int, int], masks: list[BBox]) -> np.ndarray:
    m = np.zeros(shape, bool)
    h, w = shape
    for x, y, bw, bh in masks:
        m[int(y * h) : int((y + bh) * h), int(x * w) : int((x + bw) * w)] = True
    return m


def _pad(b: BBox, frac: float = 0.2, min_size: float = 0.12) -> BBox:
    x, y, w, h = (float(v) for v in b)
    w2, h2 = max(w * (1 + 2 * frac), min_size), max(h * (1 + 2 * frac), min_size)
    cx, cy = x + w / 2, y + h / 2
    x2, y2 = max(0.0, cx - w2 / 2), max(0.0, cy - h2 / 2)
    return (round(x2, 4), round(y2, 4), round(min(w2, 1 - x2), 4), round(min(h2, 1 - y2), 4))


def _union(a: BBox | None, b: BBox) -> BBox:
    if a is None:
        return b
    x1, y1 = min(a[0], b[0]), min(a[1], b[1])
    x2, y2 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return (x1, y1, x2 - x1, y2 - y1)


def detect(frames: Iterable[tuple[float, np.ndarray]], fps: float, cfg: GateConfig | None = None) -> list[Event]:
    cfg = cfg or GateConfig()
    bg: np.ndarray | None = None
    mask = None
    raw: list[Event] = []
    globals_: list[float] = []
    blank_start: float | None = None
    blanks: list[tuple[float, float]] = []

    cur: Event | None = None
    persist = 0
    last_motion = 0.0
    last_t = 0.0

    for t, frame in frames:
        last_t = t
        f = cv2.GaussianBlur(frame, (5, 5), 0)
        h, w = f.shape
        if mask is None:
            mask = _mask_array((h, w), cfg.masks)

        # Blank / covered lens
        if float(f[~mask].std()) < cfg.blank_std:
            blank_start = t if blank_start is None else blank_start
        elif blank_start is not None:
            if t - blank_start >= cfg.blank_min_s:
                blanks.append((blank_start, t))
            blank_start = None

        if bg is None:
            bg = f.astype(np.float32)
            continue
        diff = cv2.absdiff(f, cv2.convertScaleAbs(bg))
        diff[mask] = 0
        _, th = cv2.threshold(diff, cfg.diff_threshold, 255, cv2.THRESH_BINARY)
        th = cv2.dilate(th, None, iterations=2)
        visible = max(1, int((~mask).sum()))
        changed = cv2.countNonZero(th) / visible

        if changed > cfg.global_frac:
            globals_.append(t)
            cv2.accumulateWeighted(f, bg, 0.5)
            persist = 0
            continue

        n, _, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
        min_area = cfg.min_blob_frac * visible
        blobs = [s for s in stats[1:n] if s[cv2.CC_STAT_AREA] >= min_area]
        if blobs:
            persist += 1
            area = sum(int(s[cv2.CC_STAT_AREA]) for s in blobs) / th.size
            box: BBox | None = None
            for s in blobs:
                box = _union(
                    box,
                    (
                        s[cv2.CC_STAT_LEFT] / w,
                        s[cv2.CC_STAT_TOP] / h,
                        s[cv2.CC_STAT_WIDTH] / w,
                        s[cv2.CC_STAT_HEIGHT] / h,
                    ),
                )
            if persist >= cfg.persist_frames:
                if cur is None:
                    start = t - (cfg.persist_frames - 1) / fps
                    cur = Event(start, t, box, peak_s=t, peak_area_frac=area)
                else:
                    cur.bbox = _union(cur.bbox, box)
                    cur.end_s = t
                    if area > cur.peak_area_frac:
                        cur.peak_area_frac, cur.peak_s = area, t
                last_motion = t
        else:
            persist = 0
        if cur is not None and t - last_motion > cfg.quiet_s:
            raw.append(cur)
            cur = None
        cv2.accumulateWeighted(f, bg, cfg.bg_alpha)

    if cur is not None:
        raw.append(cur)
    if blank_start is not None and last_t - blank_start >= cfg.blank_min_s:
        blanks.append((blank_start, last_t))

    events = _merge(
        [
            Event(
                max(0.0, e.start_s - cfg.pre_roll_s),
                min(last_t, e.end_s + cfg.post_roll_s),
                e.bbox,
                peak_s=e.peak_s,
                peak_area_frac=e.peak_area_frac,
            )
            for e in raw
        ],
        cfg.merge_gap_s,
    )
    events = [
        Event(e.start_s, e.end_s, _pad(e.bbox), "motion", e.peak_s, round(e.peak_area_frac, 5))
        for e in events
        if e.duration_s >= cfg.min_event_s
    ]
    events += [Event(a, b, (0, 0, 1, 1), "global_change", a) for a, b in _runs(globals_, 2.0 / fps)]
    events += [Event(a, b, (0, 0, 1, 1), "blank_view", a) for a, b in blanks]
    return sorted(events, key=lambda e: e.start_s)


def _merge(events: list[Event], gap: float) -> list[Event]:
    out: list[Event] = []
    for e in sorted(events, key=lambda e: e.start_s):
        if out and e.start_s - out[-1].end_s <= gap:
            p = out[-1]
            p.end_s = max(p.end_s, e.end_s)
            p.bbox = _union(p.bbox, e.bbox)
            if e.peak_area_frac > p.peak_area_frac:
                p.peak_area_frac, p.peak_s = e.peak_area_frac, e.peak_s
        else:
            out.append(Event(e.start_s, e.end_s, e.bbox, e.kind, e.peak_s, e.peak_area_frac))
    return out


def _runs(times: list[float], gap: float) -> list[tuple[float, float]]:
    runs: list[tuple[float, float]] = []
    for t in times:
        if runs and t - runs[-1][1] <= gap + 1e-6:
            runs[-1] = (runs[-1][0], t)
        else:
            runs.append((t, t))
    return runs
