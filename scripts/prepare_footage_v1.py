"""Download the stand-in clips from Wikimedia Commons and cut them into single-camera segments.

    uv run python scripts/prepare_footage_v1.py              # download + cut
    uv run python scripts/prepare_footage_v1.py --from DIR   # use already-downloaded originals

Real Ajax footage replaces all of this later. Stand-ins prove the pipeline works; they do
not show how it will perform on Ajax cameras. "simnight_" files are daytime clips darkened,
greyscaled and given sensor noise to imitate night infrared footage. They are not real night
footage, so report them separately.
"""

from __future__ import annotations

import argparse
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "footage" / "cams"
RAW = ROOT / "footage" / "raw"

# local name -> Commons file name (credits in footage/SOURCES.md)
SOURCES = {
    "01_night_snow_led_streetlight.webm": "Snow_under_LED_street_light_in_Tuntorp,_Brastad.webm",
    "02_night_urban_fox_lit_alley.webm": "Urban_fox_at_night.webm",
    "03_night_ir_coyotes_trailcam.webm": "Coyote_Scent_Marking,_Feb._2022.webm",
    "04_day_porch_pirates_vehicle_people.ogv": "Porch_Pirates.ogv",
    "05_day_package_theft_driveway.ogv": "Package_Theft_from_home.ogv",
    "06_day_porch_parcel_thief.ogv": "Don't_Tempt_a_Thief_with_Unattended_Parcels.ogv",
}

# segment name -> (source, start s, end s). One fixed camera view per segment.
SEGMENTS = {
    "night_snow": ("01_night_snow_led_streetlight.webm", 0, 34.8),
    "night_fox_alley": ("02_night_urban_fox_lit_alley.webm", 0, 80.2),
    "night_ir_coyotes": ("03_night_ir_coyotes_trailcam.webm", 8.0, 33.0),  # skip title cards
    "day_street_truck": ("04_day_porch_pirates_vehicle_people.ogv", 14, 35),
    "day_street_pickup": ("04_day_porch_pirates_vehicle_people.ogv", 154, 202),
    "day_driveway_walker": ("05_day_package_theft_driveway.ogv", 44, 81),
    "day_porch_parcel": ("05_day_package_theft_driveway.ogv", 82, 97.5),
    "day_porch_backpack": ("06_day_porch_parcel_thief.ogv", 0, 24.8),
}
SIMNIGHT = ["day_street_truck", "day_street_pickup", "day_driveway_walker", "day_porch_parcel", "day_porch_backpack"]
NIGHT_FILTER = "format=gray,eq=brightness=-0.22:contrast=0.85:gamma=0.8,noise=alls=14:allf=t,gblur=sigma=0.7,format=yuv420p"
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-an"]


def download(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for local, commons in SOURCES.items():
        p = dest / local
        if p.exists():
            continue
        url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(commons)
        print(f"downloading {commons}")
        req = urllib.request.Request(url, headers={"User-Agent": "camai-footage-fetch/0.1"})
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
    for name, (src, start, end) in SEGMENTS.items():
        out = OUT / f"{name}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-to", str(end), "-i", str(raw / src),
                        "-vf", "scale='min(1280,iw)':-2,fps=15", *ENC, str(out)], check=True)
        print("wrote", out.relative_to(ROOT))
    for name in SIMNIGHT:
        out = OUT / f"{name.replace('day_', 'simnight_')}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT / f"{name}.mp4"),
                        "-vf", f"scale='min(960,iw)':-2,{NIGHT_FILTER}", *ENC, str(out)], check=True)
        print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
