"""Deterministic synthetic clip for pipeline tests (never used in headline metrics).

Timeline (30 s, 640x360, dark yard with sensor noise):
  5-12 s : a bright 'person' box walks left to right  -> one motion event
  20-21 s: whole frame flashes (headlight / IR switch) -> global_change, not motion
"""
import subprocess
from pathlib import Path

PERSON = (5.0, 12.0)
FLASH = (20.0, 21.0)


def make_clip(out: Path, seconds: int = 30) -> Path:
    graph = (
        f"color=c=0x1c2023:s=640x360:d={seconds}:r=10,"
        "drawbox=x=0:y=240:w=640:h=120:color=0x2e3230:t=fill[bg];"
        f"color=c=0xd8dad6:s=26x70:d={seconds}:r=10[p];"
        "[bg][p]overlay=x='60+(t-5)*60':y=190:eval=frame:enable='between(t,5,12)',"
        "drawbox=x=0:y=0:w=640:h=360:color=0xe0e0d0:t=fill:enable='between(t,20,21)',"
        "noise=alls=6:allf=t[out]"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-filter_complex", graph, "-map", "[out]",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return out
