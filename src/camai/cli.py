"""Command line: camai process | brief | serve | eval | check."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from camai.site import load_site


def _load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal .env loader (KEY=value lines); real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
DATA = Path(os.environ.get("CAMAI_DATA", "data"))


def _claude(no_ai: bool):
    if no_ai:
        return None
    from camai.llm import default_claude

    return default_claude(DATA / "llm_cache")


def _store():
    from camai.store import Store

    return Store(DATA / "camai.sqlite")


def cmd_process(a):
    from camai.pipeline import process_site

    store = _store()
    for p in a.sites:
        site = load_site(p)
        if a.fresh:
            store.clear_site(site.id)
        process_site(site, _claude(a.no_ai), store, DATA / "media")


def cmd_analyse(a):
    from camai.analysis import analyse_site

    store = _store()
    claude = _claude(False)
    for p in a.sites:
        analyse_site(load_site(p), store, claude, DATA / "media")


def _app(paths, no_ai=False):
    from camai.api import create_app

    return create_app([load_site(p) for p in paths], _store(), DATA / "media", _claude(no_ai))


def cmd_brief(a):
    from fastapi.testclient import TestClient

    site = load_site(a.site)
    c = TestClient(_app([a.site], a.no_ai))
    b = c.get(f"/api/v1/sites/{site.id}/brief", params={"night": a.night} if a.night else None).json()
    if a.json:
        print(json.dumps(b, indent=1, default=str))
        return
    print(f"{site.name} - night of {b['night']}  [{b['status']}]\n{b['headline']}\n")
    for i in b["incidents"]:
        print(f"  INCIDENT {i['start'][11:16]}-{i['end'][11:16]} {i['severity']:<12} {i['headline']}")
        if i["alarm"]:
            print(f"           alarm: {i['alarm']['verdict_text']}")
    for e in b["fyi"]:
        print(f"  fyi      {e['start'][11:16]} {e['camera_name']:<20} {e['title']}")
    for c_ in b["lockup"]:
        print(f"  lock-up  {'ok ' if c_['ok'] else 'NO '} {c_['camera_name']:<20} {c_['question']} -> {c_['answer']}")
    for x in b["assets"]:
        print(f"  asset    {x['status']:<8} {x['text']}")
    if b["patrol"]:
        print(f"  patrol   coverage {b['patrol']['coverage_pct']}%  " + "; ".join(m["text"] for m in b["patrol"]["missed"]))
    for r in b["repeat_vehicles"]:
        print(f"  repeat   {r['text']}")
    for h in b["health"]:
        print(f"  camera   {h['camera_name']}: {h['note']}")
    print(f"\nIgnored: {b['ignored']}\nEstimated API cost of the night's AI: ${b['est_cost_usd']:.4f}")


def cmd_serve(a):
    import uvicorn

    uvicorn.run(_app(a.sites, a.no_ai), host=a.host, port=a.port)


def cmd_eval(a):
    from camai.evaluate import run_eval

    print(run_eval(load_site(a.site), _store(), Path(a.labels), json_out=a.json))


def cmd_check(a):
    from camai.checks import available_checkers
    from camai.llm import Image

    claude = _claude(False)
    images = [Image.from_path(Path(p)) for p in a.images]
    options = a.options.split(",")
    for c in available_checkers(claude):
        r = c.check(a.question, options, images)
        print(f"{c.name:<10} answer={r.answer:<10} confidence={r.confidence:.2f}  {r.latency_ms}ms  ${r.est_cost_usd:.5f}  {r.raw.get('why', '')}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="camai", description="AI layer for a unified camera view (proof of concept)")
    sub = ap.add_subparsers(required=True)

    p = sub.add_parser("process", help="Run motion gate + AI description over a site's footage")
    p.add_argument("sites", nargs="+")
    p.add_argument("--no-ai", action="store_true", help="Motion gate only, no Claude calls")
    p.add_argument("--fresh", action="store_true", help="Delete this site's stored events first")
    p.set_defaults(fn=cmd_process)

    p = sub.add_parser("analyse", help="Re-run lock-up checks, escalation and incidents (no motion detection)")
    p.add_argument("sites", nargs="+")
    p.set_defaults(fn=cmd_analyse)

    p = sub.add_parser("brief", help="Print the morning brief for a site")
    p.add_argument("site")
    p.add_argument("--night", help="YYYY-MM-DD, the date the night starts (default: latest)")
    p.add_argument("--json", action="store_true")
    p.add_argument("--no-ai", action="store_true")
    p.set_defaults(fn=cmd_brief)

    p = sub.add_parser("serve", help="Serve the app and the /api/v1 JSON API")
    p.add_argument("sites", nargs="+")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-ai", action="store_true")
    p.set_defaults(fn=cmd_serve)

    p = sub.add_parser("eval", help="Score stored results against hand labels")
    p.add_argument("site")
    p.add_argument("--labels", default="labels")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_eval)

    p = sub.add_parser("check", help="Ask a fixed question about image(s) with every available checker")
    p.add_argument("question")
    p.add_argument("images", nargs="+")
    p.add_argument("--options", default="yes,no")
    p.set_defaults(fn=cmd_check)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
