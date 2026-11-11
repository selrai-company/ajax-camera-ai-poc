# Camera AI layer for job sites

AI on top of a unified Ajax camera view, for construction and trade businesses with sites
that sit empty after hours. It watches every camera, writes down what happened in plain
English, decides what actually needs a person, and shows it all on a live camera wall.

**What it does**

- **Live camera wall** with an AI insight rail: incidents appear as they happen, with an
  animated box on the video showing where to look.
- **Incidents across cameras**: "Person worked at the gate lock on the Site gate camera; vehicles
  followed on the yard cameras", with the key frame, the clip, AI-marked moments, and every
  reason tagged as coming from the AI or from a site rule.
- **Plain-English search**: "people near the container after 10pm", answered with citations
  to the clips.
- **6am morning brief** (the phone home screen): what needs a look, lock-up and perimeter
  checks, missing assets, patrol coverage, deliveries, repeat vehicles, camera health.
- **Guard patrols**: a rostered guard in security clothing is a patrol (blue), never an
  alert, and never clears anyone else. Checkpoint-by-round coverage, no individual scoring.
- **Alarm verification**: an Ajax alarm is matched to the footage ("Verified: person visible").
- **Evidence pack**: a PDF with the timeline, annotated frames and clip hashes.
- **Site rules that learn**: "Not a problem" for one event, or a previewed recurring rule.
  A person seen while armed is never hidden.
- **All sites** triage for owners and monitoring teams with many sites.

**How it decides**

```
recordings ─► motion detection ─► Haiku 5.5 describes ─► site rules decide ─► Sonnet 5.5 re-looks
              (no AI; tracks         each event (frames    (armed? guard?        at anything flagged
               where it moves)       + close-up crop)      zone? tampering?)     (zoomed crops), writes
                                                                                 headlines, runs checks
```

The AI describes; plain-code rules decide. It never identifies people or judges intent, and
"can't tell" is always allowed.

## Quick start

Needs macOS or Linux with `ffmpeg`, [`uv`](https://docs.astral.sh/uv/), and either an
Anthropic API key or the Claude Code CLI signed in (for local testing).

```bash
uv sync
cp .env.example .env                               # choose the Claude backend (see below)
uv run python scripts/prepare_jobsite_footage.py   # fetch the job-site demo clips (~20 MB)
uv run python scripts/prepare_footage_v1.py        # plus three night clips Hillcrest reuses
uv run camai process sites/ridgeview.yaml sites/hillcrest.yaml
uv run camai serve sites/ridgeview.yaml sites/hillcrest.yaml   # http://127.0.0.1:8000
```

The built web app is committed in `src/camai/static/app`, so Node isn't needed to run it. To
work on the frontend: `cd web && npm install && npm run dev` (proxies `/api` and `/media` to
:8000), or `VITE_API_MOCK=1 npm run dev` for mock data. `npm run build` rebuilds the served app.

| Command | What it does |
|---|---|
| `camai process <site.yaml>...` | Motion detection, AI descriptions, checks, escalation and incidents |
| `camai analyse <site.yaml>...` | Re-run checks, escalation and incidents without re-detecting motion |
| `camai brief <site.yaml> [--night YYYY-MM-DD]` | Print the morning brief |
| `camai serve <site.yaml>...` | The app plus the `/api/v1` JSON API |
| `camai check "Is the gate open?" frame.jpg` | Fixed-question check with each configured checker (Claude; TypeSafe Jev when keyed) |

## Claude backends

Set `CAMAI_CLAUDE_BACKEND` in `.env`:

- `api`: the Anthropic SDK with `ANTHROPIC_API_KEY`. Use this in production.
- `subscription`: the local `claude -p` CLI on a claude.ai login. For local testing only.

Responses are cached in `data/llm_cache/`, so re-running on unchanged footage costs nothing.
Typical cost at API prices: about $0.001 per event described by Haiku, and a few cents a night
for Sonnet escalations, checks and headlines.

## The demo

Two demo sites tell one night's story with freely licensed stand-in footage (credits in
`footage/SOURCES.md`), including a real public-domain sheriff's office CCTV clip of a septic
tank being stolen from a construction site.

- **Ridgeview Apartments, Stage 2** (guarded): crews and a delivery by day, a floodlit concrete
  pour, lock-up at 8:30pm, the guard's 6:05pm check at the gatehouse and then no patrols, a
  torch on the back track at 1:40am, and at 2:03–2:09am someone at the north boundary, the gate
  lock being worked (Ajax alarm, simulated) and the tank being towed out across two yard
  cameras. The second night is quiet apart from the same kind of van again.
- **Hillcrest Plant Yard** (unguarded): a camera taped over at 4:42pm, machinery working on the
  ridge at 10:40pm while armed, and foxes, coyotes and rain that are correctly ignored.

Stand-in clips are placed on a timeline; on the wall, **Live view** loops each camera's clips
and **Replay** plays the night against a clock. Both are labelled as recorded footage.

## Integrating it

See [`INTEGRATION.md`](INTEGRATION.md): run the Python service beside your app, then embed or
port the React app. The API contract is `web/src/api/types.ts` and [`docs/API.md`](docs/API.md).

## Known limitations

- **No login.** It binds to 127.0.0.1; put your app's auth in front before exposing it.
- **Motion boxes come from motion, not object detection.** They mark where movement is, which is
  usually the subject but can be its torch beam or a shadow.
- **The AI can miss subtle actions** in small, grainy night footage. On the real theft clip it
  sees "a white car" and "a person moving a pipe stack" rather than the tow itself. Flagged
  events go to a person with the clip either way.
- **A person standing still fades into the background** after about six seconds.
- **Armed state comes from clock hours** until the Ajax Enterprise API is connected, and times
  are local.
