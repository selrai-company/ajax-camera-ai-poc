"""Video in, frames out. Everything that touches ffmpeg lives here.

``FileSource`` reads recorded files today. An ``RtspSource`` with the same
``iter_gray`` shape can replace it later without changing anything downstream.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np

BBox = tuple[float, float, float, float]  # normalised x, y, w, h in 0..1


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration: float


def probe(path: Path) -> VideoInfo:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate:format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    s = d["streams"][0]
    num, den = (s.get("r_frame_rate") or "0/1").split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    return VideoInfo(int(s["width"]), int(s["height"]), fps, float(d["format"]["duration"]))


class FileSource:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.info = probe(self.path)

    def iter_gray(self, width: int = 320, fps: float = 4.0) -> Iterator[tuple[float, np.ndarray]]:
        """Yield (seconds, grayscale frame) at a low rate and size for motion analysis."""
        info = self.info
        height = int(round(info.height * width / info.width / 2) * 2)
        proc = subprocess.Popen(
            [
                "ffmpeg", "-v", "error", "-i", str(self.path),
                "-vf", f"fps={fps},scale={width}:{height},format=gray",
                "-f", "rawvideo", "-",
            ],
            stdout=subprocess.PIPE,
        )
        assert proc.stdout
        size = width * height
        i = 0
        try:
            while True:
                buf = proc.stdout.read(size)
                if len(buf) < size:
                    break
                yield i / fps, np.frombuffer(buf, np.uint8).reshape(height, width)
                i += 1
        finally:
            proc.stdout.close()
            proc.wait()

    def grab(self, t: float, out: Path, crop: BBox | None = None, max_width: int = 1024) -> Path:
        """Save one full-resolution frame (optionally cropped) as JPEG."""
        out.parent.mkdir(parents=True, exist_ok=True)
        filters = []
        if crop:
            x, y, w, h = crop
            iw, ih = self.info.width, self.info.height
            cw, ch = max(16, int(w * iw)) // 2 * 2, max(16, int(h * ih)) // 2 * 2
            filters.append(f"crop={cw}:{ch}:{int(x * iw)}:{int(y * ih)}")
        filters.append(f"scale='min({max_width},iw)':-2")
        t = max(0.0, min(t, self.info.duration - 0.05))
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(self.path),
                "-frames:v", "1", "-vf", ",".join(filters), "-q:v", "4", str(out),
            ],
            check=True,
        )
        return out

    def cut(self, start: float, end: float, out: Path, max_width: int = 960) -> Path:
        """Cut a browser-playable H.264 clip."""
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, start):.3f}", "-to", f"{end:.3f}",
                "-i", str(self.path), "-vf", f"scale='min({max_width},iw)':-2",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-an", str(out),
            ],
            check=True,
        )
        return out
