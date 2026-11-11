# Camera AI layer (proof of concept)

An AI layer for a unified Ajax camera view. It turns a night of footage into a **6am morning
brief** a site manager can read in 30 seconds: what needs a look, what's just for their
information, and why everything else was ignored.

```
footage ──► motion gate ──► Haiku 5.5 describes ──► site rules decide ──► morning brief
            (no AI, free)    each event from         severity (plain      (Sonnet 5.5 writes
                             ordered frames +        code: armed? zone?    the headline; quiet
                             a close-up crop         person?)              nights cost nothing)
```

Design rules this build follows:

- **The AI describes; site rules decide.** Haiku says what is visible (person, vehicle,
  animal, weather; what they did; what they carried; what it can't tell). Plain code decides
  severity from the site context. There is no AI "risk score".
- **No identifying people.** The prompt forbids identity, gender, age and ethnicity, and
  forbids judging intent. "Can't tell" is always an allowed answer.
- **Quiet nights stay quiet.** A night with nothing to look at is one line, written without
  an AI call.
- **"Not a problem" teaches the site.** One click saves a rule (camera + activity + hour)
  that hides matching events from future briefs.

## Quick start

Needs macOS or Linux with `ffmpeg`, [`uv`](https://docs.astral.sh/uv/), and either the
Claude Code CLI signed in (for testing) or an Anthropic API key (for production).

```bash
uv sync
cp .env.example .env                          # pick the Claude backend (see below)
uv run python scripts/prepare_footage.py      # fetch the stand-in clips (~45 MB)
uv run camai process sites/ridgeview.yaml sites/hillcrest.yaml
uv run camai serve sites/ridgeview.yaml sites/hillcrest.yaml   # http://127.0.0.1:8000
```

Other commands:

| Command | What it does |
|---|---|
| `camai process <site.yaml>... [--no-ai] [--fresh]` | Motion gate + Haiku descriptions, stored in `data/` |
| `camai brief <site.yaml> [--json]` | Print the morning brief |
| `camai serve <site.yaml>...` | Web page for the brief, with clips and "Not a problem" |
| `camai eval <site.yaml>` | Score results against the hand labels in `labels/` |
| `camai check "Is the gate open?" frame.jpg` | Fixed-question check with every configured checker (Haiku; Jev when keyed) |

## Claude backends

Set `CAMAI_CLAUDE_BACKEND` in `.env`:

- `subscription` (default): calls Claude through the local `claude -p` CLI on your claude.ai
  login. **For local testing only, never for customers.** Input tokens are estimated from what
  was sent, so reported costs match what the API would charge.
- `api`: the Anthropic SDK with `ANTHROPIC_API_KEY`. Use this in production. Sonnet calls
  enable server-side fallback if a safety classifier declines a request.

Every model response is cached in `data/llm_cache/`, keyed on the frames, prompt and model, so
re-running `process` or `eval` on unchanged footage costs nothing.

## Site config

`sites/*.yaml` lists the cameras, the armed window (`from == to` means armed all day), zones
(normalised `[x, y, w, h]` boxes, optionally `restricted`) and masks for burned-in timestamps.
In production, arming state should come from the Ajax Enterprise API instead of fixed hours;
see `docs/ajax-integration.md`.

## Footage and results

The demo uses freely licensed stand-in clips from Wikimedia Commons (credits in
`footage/SOURCES.md`), not Ajax footage. `simnight_` clips are daytime footage darkened to
imitate night infrared. **Stand-ins prove the pipeline works; they say little about accuracy
on real Ajax cameras.** Results for the two runs are in `results/`. Labels were written and
committed before any model ran (`labels/README.md`).

## Layout

```
src/camai/
  ingest.py    ffmpeg in/out: low-res grayscale for the gate, full-res frames, crops, clips
  gate.py      motion gate (rolling background, blobs, events, lighting changes, blank view)
  describe.py  Haiku event description: prompt + JSON schema
  rules.py     severity rules and "Not a problem" rules (pure functions)
  brief.py     the morning brief (Sonnet headline only when something needs a look)
  checks.py    fixed-question checks; Haiku now, TypeSafe Jev behind a switch (docs/jev.md)
  llm.py       Claude access: subscription CLI or API backend, cache, cost estimate
  store.py     SQLite for events and rules
  evaluate.py  scores the gate and the AI separately against hand labels
  web.py       FastAPI app; static/index.html renders the brief
```

## What's next

1. Real Ajax footage: label a few real nights, re-run `camai eval`, then tune.
2. Live input: an `RtspSource` beside `FileSource`, and arming state from the Enterprise API.
3. Live alarm check: when an Ajax alarm fires, describe the last 30 seconds and push it.
4. The Batch API for the morning brief (half price), and the Jev side-by-side test once there's a key.
