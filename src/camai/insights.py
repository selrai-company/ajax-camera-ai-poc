"""Cross-night insights: deliveries, repeat vehicles (possible casing), suggested rules,
and asset checks (present at lock-up, gone in the morning)."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date

from camai.rules import activity_label
from camai.site import Site, night_of
from camai.store import Store

COLOURS = ["white", "black", "grey", "gray", "silver", "red", "blue", "green", "yellow", "orange", "brown", "dark", "light"]
VEHICLES = ["ute", "pickup", "van", "truck", "car", "suv", "sedan", "trailer", "tipper", "minivan", "4wd", "wagon"]
SUGGEST_AFTER = 3


def vehicle_key(report: dict | None) -> str | None:
    """A coarse vehicle description ("white ute") from the AI report. No plates, ever."""
    if not report or report.get("vehicle_present") != "yes":
        return None
    text = " ".join([*(report.get("vehicle_types") or []), report.get("search_text") or "", report.get("summary") or ""]).lower()
    kind = next((v for v in VEHICLES if re.search(rf"\b{v}\b", text)), None)
    if not kind:
        return None
    colour = next((c for c in COLOURS if re.search(rf"\b{c}\b[\w\s-]{{0,12}}\b{kind}\b", text)), None)
    kind = {"pickup": "ute", "sedan": "car", "gray": "grey", "minivan": "van"}.get(kind, kind)
    colour = {"gray": "grey"}.get(colour or "", colour)
    return f"{colour} {kind}" if colour else kind


def repeat_vehicles(site: Site, store: Store, upto: date) -> list[dict]:
    """Same kind of vehicle seen while armed on 2+ different nights (up to and including `upto`)."""
    seen: dict[str, list[dict]] = defaultdict(list)
    for e in store.events(site.id):
        if night_of(e["ts"]) > upto or not site.has_camera(e["camera_id"]) or not site.is_armed(e["ts"]):
            continue
        key = vehicle_key(e["report"])
        if key and " " in key:  # require a colour, so "car" alone doesn't match everything
            seen[key].append(e)
    out = []
    for key, evs in seen.items():
        nights = sorted({str(night_of(e["ts"])) for e in evs})
        if len(nights) >= 2:
            cams = sorted({site.camera(e["camera_id"]).name for e in evs})
            out.append({
                "description": key.capitalize(),
                "nights": nights,
                "events": evs,
                "text": f"{key.capitalize()} seen near {', '.join(cams)} on {len(nights)} nights while armed",
            })
    return sorted(out, key=lambda r: -len(r["nights"]))


def deliveries(site: Site, events: list[dict]) -> list[dict]:
    out = []
    for e in events:
        r = e["report"] or {}
        if r.get("activity") in ("delivery", "vehicle_arriving") and not site.is_armed(e["ts"]):
            out.append(e)
        elif r.get("activity") == "delivery":
            out.append(e)
    return out


def suggestions(site: Site, store: Store) -> list[dict]:
    """After the same kind of event on the same camera is dismissed 3 times, suggest a rule."""
    counts: dict[tuple[str, str], list[dict]] = defaultdict(list)
    existing = {(r.camera_id, r.activity) for r in store.rules(site.id)}
    for e in store.events(site.id):
        if e["dismissed"] and e["report"] and site.has_camera(e["camera_id"]):
            counts[(e["camera_id"], e["report"].get("activity", "other"))].append(e)
    out = []
    for (cam_id, activity), evs in counts.items():
        if len(evs) >= SUGGEST_AFTER and (cam_id, activity) not in existing:
            out.append({"camera_id": cam_id, "camera_name": site.camera(cam_id).name,
                        "activity_label": activity_label(activity), "dismissed_count": len(evs), "event": evs[-1]})
    return out


def asset_checks(site: Site, store: Store, night: date) -> list[dict]:
    rows = [r for r in store.lockup(site.id, str(night)) if r["phase"].startswith("asset_")]
    by_asset: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["camera_id"], r["label"] or r["question"])
        by_asset.setdefault(key, {"camera_id": r["camera_id"], "asset": r["label"] or r["question"]})[r["phase"]] = r
    out = []
    for (cam_id, asset), d in by_asset.items():
        ev, mo = d.get("asset_evening"), d.get("asset_morning")
        cam = site.camera(cam_id).name if site.has_camera(cam_id) else cam_id

        def t(x):
            return f"{x['at']:%-I:%M%p}".replace("AM", "am").replace("PM", "pm")

        if ev and mo and ev["answer"] == "yes" and mo["answer"] == "no":
            status, text = "missing", f"{asset} was there at {t(ev)} and isn't at {t(mo)}"
        elif ev and mo and ev["answer"] == "no" and mo["answer"] == "yes":
            status, text = "arrived", f"{asset} wasn't there at {t(ev)} but is at {t(mo)}"
        elif ev and mo and ev["answer"] == mo["answer"] == "yes":
            status, text = "present", f"{asset} in place at {t(ev)} and {t(mo)}"
        else:
            status, text = "unclear", f"Couldn't confirm the {asset.lower()} on {cam}"
        out.append({"camera_id": cam_id, "camera_name": cam, "asset": asset, "evening": ev, "morning": mo,
                    "status": status, "text": text})
    return out
