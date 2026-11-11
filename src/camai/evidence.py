"""One-click evidence pack: a PDF for police or the insurer.

Timeline, annotated key frames, the AI's factual descriptions, what it couldn't tell, the
alarm (if any) and SHA-256 hashes of the original clips so they can be verified later.
"""

from __future__ import annotations

import hashlib
import tempfile
from datetime import datetime
from pathlib import Path

import cv2
from fpdf import FPDF

from camai.rules import activity_label
from camai.site import Site


def _latin(s: str) -> str:
    rep = {"–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...",
           "·": "-", "→": "->", "•": "-"}
    for a, b in rep.items():
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


def _t(ts: datetime) -> str:
    return f"{ts:%-I:%M:%S%p}".replace("AM", "am").replace("PM", "pm")


def annotated_frame(media_root: Path, e: dict, out_dir: Path) -> Path | None:
    m = e["media"]
    if not m.get("key_frame"):
        return None
    src = media_root / m["dir"] / m["key_frame"]
    img = cv2.imread(str(src))
    if img is None:
        return None
    track = m.get("track") or []
    times = m.get("frame_times") or []
    frames = m.get("frames") or []
    box = None
    if track and m["key_frame"] in frames and len(times) == len(frames):
        kt = times[frames.index(m["key_frame"])]
        box = min(track, key=lambda p: abs(p["t"] - kt))["box"]
    if box:
        h, w = img.shape[:2]
        x, y, bw, bh = box
        pad = 0.15
        x0, y0 = max(0, int((x - bw * pad) * w)), max(0, int((y - bh * pad) * h))
        x1, y1 = min(w - 1, int((x + bw * (1 + pad)) * w)), min(h - 1, int((y + bh * (1 + pad)) * h))
        cv2.rectangle(img, (x0, y0), (x1, y1), (60, 60, 230), 3)
        cv2.putText(img, "Movement", (x0 + 4, max(18, y0 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 230), 2)
    out = out_dir / f"ev{e['id']}.jpg"
    cv2.imwrite(str(out), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return out


def build_pdf(site: Site, incident: dict, events: list[dict], media_root: Path) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, _latin("Incident evidence pack"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 6, _latin(f"{site.name}  -  {incident['start']:%A %-d %B %Y}, {_t(incident['start'])} to {_t(incident['end'])}"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _latin(f"Generated {datetime.now():%-d %b %Y %H:%M}  -  Incident #{incident['id']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 12)
    pdf.multi_cell(0, 6, _latin(incident.get("headline") or ""), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    if incident.get("alarm"):
        a = incident["alarm"]
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, _latin(f"Alarm: {a['zone']} at {_t(datetime.fromisoformat(a['at']))}. {a['verdict_text']}."
                                    + (" (Simulated alarm feed in this demo.)" if a.get("simulated") else "")))
        pdf.ln(2)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Timeline", new_x="LMARGIN", new_y="NEXT")
    with tempfile.TemporaryDirectory() as tmp:
        for e in events:
            r = e["report"] or {}
            cam = site.camera(e["camera_id"]).name if site.has_camera(e["camera_id"]) else e["camera_id"]
            pdf.set_font("Helvetica", "B", 10)
            pdf.multi_cell(0, 5, _latin(f"{_t(e['ts'])} - {_t(e['end_ts'])}   {cam}   ({activity_label(r.get('activity'))})"), new_x="LMARGIN", new_y="NEXT")
            img = annotated_frame(media_root, e, Path(tmp))
            if img:
                if pdf.get_y() > 200:
                    pdf.add_page()
                pdf.image(str(img), w=120)
            pdf.set_font("Helvetica", "", 10)
            if r.get("summary"):
                pdf.multi_cell(0, 5, _latin(r["summary"]), new_x="LMARGIN", new_y="NEXT")
            if r.get("movement"):
                pdf.set_text_color(70, 70, 70)
                pdf.multi_cell(0, 5, _latin(r["movement"]), new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(0, 0, 0)
            if r.get("items_carried"):
                pdf.multi_cell(0, 5, _latin("Carried: " + ", ".join(r["items_carried"])), new_x="LMARGIN", new_y="NEXT")
            if r.get("cant_tell"):
                pdf.set_text_color(110, 110, 110)
                pdf.multi_cell(0, 5, _latin("The AI couldn't tell: " + "; ".join(r["cant_tell"])), new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(0, 0, 0)
            clip = media_root / e["media"]["dir"] / (e["media"].get("clip") or "")
            if e["media"].get("clip") and clip.exists():
                digest = hashlib.sha256(clip.read_bytes()).hexdigest()
                pdf.set_font("Courier", "", 8)
                pdf.multi_cell(0, 4, _latin(f"Clip {e['media']['dir']}/{e['media']['clip']}  SHA-256 {digest}"), new_x="LMARGIN", new_y="NEXT")
            pdf.ln(3)

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(0, 4, _latin(
        "Descriptions were written by an AI model from the camera frames and describe what is visible only. "
        "They do not identify anyone or establish intent. Boxes mark detected movement. Original clips are "
        "retained; hashes above let a recipient confirm a copy is unaltered."))
    return bytes(pdf.output())
