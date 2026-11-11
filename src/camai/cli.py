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


def cmd_brief(a):
    from camai.brief import build_brief

    site = load_site(a.site)
    b = build_brief(site, _store(), _claude(a.no_ai))
    if a.json:
        print(json.dumps(b, indent=1, default=str))
        return
    print(f"{b['site']['name']}  [{b['status']}]\n{b['headline']}\n")
    for e in b["events"]:
        if e["severity"] != "ignore":
            print(f"  {e['ts'][11:19]}  {e['severity']:<12} {e['camera_name']:<14} {e['title']}")
    print(f"\nIgnored: {b['ignored_reasons']}\nEstimated API cost: ${b['est_api_cost_usd']:.4f}")


def cmd_serve(a):
    import uvicorn

    from camai.web import create_app

    sites = [load_site(p) for p in a.sites]
    app = create_app(sites, _store(), DATA / "media", _claude(a.no_ai))
    uvicorn.run(app, host=a.host, port=a.port)


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

    p = sub.add_parser("brief", help="Print the morning brief for a site")
    p.add_argument("site")
    p.add_argument("--json", action="store_true")
    p.add_argument("--no-ai", action="store_true")
    p.set_defaults(fn=cmd_brief)

    p = sub.add_parser("serve", help="Serve the morning brief web page")
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
