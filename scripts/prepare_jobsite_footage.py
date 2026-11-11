"""Download and prepare the job-site stand-in footage for the demo sites.

    uv run python scripts/prepare_jobsite_footage.py              # download + prepare
    uv run python scripts/prepare_jobsite_footage.py --from DIR   # use already-downloaded originals

Credits and licences are in footage/SOURCES.md. Real Ajax footage replaces all of this.
Notes on edits:
- The septic tank theft (real, public-domain sheriff's office CCTV) has its captions, logo and
  burned-in clock smoothed out, and the title card and mugshot cut.
- Vertical clips are centre-cropped to 16:9.
- `pole_cam_covered` is generated (grey, sensor noise): it stands in for a camera whose lens
  has just been taped over, as seen in `tamper_watch`.
"""

from __future__ import annotations

import argparse
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "footage" / "jobsite"
RAW = ROOT / "footage" / "raw-jobsite"

SOURCES = {
    "commons_septic_tank_theft.webm": "https://upload.wikimedia.org/wikipedia/commons/5/54/Florida_Man_Arrested_for_Attempting_to_Steal_a_Septic_Tank.webm",
    "mixkit_31380.mp4": "https://assets.mixkit.co/videos/31380/31380-720.mp4",
    "pexels_6258198.mp4": "https://videos.pexels.com/video-files/6258198/6258198-hd_1080_1920_24fps.mp4",
    "pexels_11839732.mp4": "https://videos.pexels.com/video-files/11839732/11839732-hd_1920_1080_25fps.mp4",
    "pexels_19405094.mp4": "https://videos.pexels.com/video-files/19405094/19405094-hd_1920_1080_50fps.mp4",
    "pexels_6831476.mp4": "https://videos.pexels.com/video-files/6831476/6831476-hd_1080_1920_25fps.mp4",
    "pexels_39644096.mp4": "https://videos.pexels.com/video-files/39644096/16900666_3840_2160_30fps.mp4",
    "pexels_35039490.mp4": "https://videos.pexels.com/video-files/35039490/14843024_3840_2160_30fps.mp4",
    "pexels_35039487.mp4": "https://videos.pexels.com/video-files/35039487/14842928_3840_2160_30fps.mp4",
    "pexels_38885275.mp4": "https://videos.pexels.com/video-files/38885275/16533594_1920_1080_25fps.mp4",
    "pexels_38885267.mp4": "https://videos.pexels.com/video-files/38885267/16533553_1920_1080_25fps.mp4",
    "pexels_7084482.mp4": "https://videos.pexels.com/video-files/7084482/7084482-hd_1920_1080_25fps.mp4",
    "pexels_40197518.mp4": "https://videos.pexels.com/video-files/40197518/17173519_3840_2160_30fps.mp4",
    "pexels_34196525.mp4": "https://videos.pexels.com/video-files/34196525/14494448_1920_1080_24fps.mp4",
    "pexels_29629758.mp4": "https://videos.pexels.com/video-files/29629758/12749752_1920_1080_25fps.mp4",
}

VERT = "crop=iw:iw*9/16"  # centre-crop a vertical clip to 16:9
# The theft clip (854x480): crop away the caption band (bottom) and the sheriff's logo (right),
# keeping the 16:9 area where everything happens, then blur the burned-in clock (top left).
SEPTIC_CLEAN = "crop=654:368:0:0,split[a][b];[b]crop=164:40:0:6,gblur=sigma=14[c];[a][c]overlay=0:6"
# name -> (source, start, end or None, extra filter or None)
SEGMENTS = {
    # The original cuts between two cameras at 58.5 s: the yard, then the access road.
    "yard_theft": ("commons_septic_tank_theft.webm", 9.0, 58.4, SEPTIC_CLEAN),
    "yard_road": ("commons_septic_tank_theft.webm", 58.8, 98.0, SEPTIC_CLEAN),
    "yard_idle": ("commons_septic_tank_theft.webm", 9.0, 10.0,
                  SEPTIC_CLEAN + ",trim=end_frame=1,loop=loop=44:size=1,setpts=N/15/TB"),  # 3 s hold, yard before the theft
    "gate_idle": ("mixkit_31380.mp4", 0, 1.0, "trim=end_frame=1,loop=loop=44:size=1,setpts=N/15/TB"),  # 3 s hold of the empty gate
    "gate_lockpick": ("mixkit_31380.mp4", 0, None, None),
    "tamper_watch": ("pexels_6258198.mp4", 0, None, VERT),
    "fog_walker": ("pexels_11839732.mp4", 0, None, None),
    "torch_track": ("pexels_19405094.mp4", 0, None, None),
    "headtorches": ("pexels_6831476.mp4", 0, None, VERT),
    "street_van": ("pexels_39644096.mp4", 0, None, None),
    "night_pour": ("pexels_35039490.mp4", 0, None, None),
    "pump_trucks": ("pexels_35039487.mp4", 0, None, None),
    "delivery_flatbed": ("pexels_38885275.mp4", 0, None, None),
    "excavator_day": ("pexels_38885267.mp4", 0, None, None),
    "laneway_hoarding": ("pexels_7084482.mp4", 0, None, None),
    "truck_yard": ("pexels_40197518.mp4", 0, None, None),
    "earthworks_night": ("pexels_34196525.mp4", 0, None, None),
    "guard_post": ("pexels_29629758.mp4", 0, None, None),
}
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-an"]


def download(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        p = dest / name
        if p.exists():
            continue
        print("downloading", name)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (camai footage fetch)"})
        with urllib.request.urlopen(req) as r, open(p, "wb") as f:
            f.write(r.read())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", type=Path, help="folder that already holds the originals")
    a = ap.parse_args()
    raw = a.src or RAW
    if not a.src:
        download(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, start, end, vf) in SEGMENTS.items():
        out = OUT / f"{name}.mp4"
        filters = [f for f in (vf, "scale='min(1280,iw)':-2", "fps=15") if f]
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(start)]
        if end:
            cmd += ["-to", str(end)]
        cmd += ["-i", str(raw / src), "-vf", ",".join(filters), *ENC, str(out)]
        subprocess.run(cmd, check=True)
        print("wrote", out.relative_to(ROOT))
    # A taped-over lens: dark grey with sensor noise, 75 s.
    out = OUT / "pole_cam_covered.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2b2d2f:s=1280x720:d=75:r=15",
                    "-vf", "noise=alls=5:allf=t", *ENC, str(out)], check=True)
    print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
