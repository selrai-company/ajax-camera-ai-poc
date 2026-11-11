# Integrating the camera AI layer into your app

This repo is two parts that talk over a JSON API:

- **`src/camai/`**: a Python service (FastAPI). It watches footage, asks Claude what happened,
  decides what needs a look, and serves `/api/v1` plus media files.
- **`web/`**: a React app (Vite, TypeScript, Tailwind) that renders the camera wall, incidents,
  search, morning brief, patrols and settings from that API.

Run the Python service next to your app as a sidecar. Either embed the React app as it is
(served by the service at `/`, or in an iframe), or port its pages into your app. The contract
in `web/src/api/types.ts` and `docs/API.md` is the only thing they share.

## Connect your footage in three steps

1. **Describe your sites** in `sites/<site>.yaml`: cameras, armed hours, zones, guard shift and
   checkpoints, lock-up questions, assets. Copy `sites/ridgeview.yaml` as a starting point.
2. **Point cameras at recordings.** Each camera lists `recordings` (a file and its start time).
   For live Ajax cameras, record rolling segments from RTSP (the Ajax apps generate RTSP links;
   check ONVIF on your firmware) into files and add them as recordings, or implement an
   `RtspSource` beside `FileSource` in `src/camai/ingest.py`.
3. **Run it:**
   ```bash
   uv sync
   cp .env.example .env              # set CAMAI_CLAUDE_BACKEND=api and ANTHROPIC_API_KEY
   uv run camai process sites/*.yaml # motion detection + AI descriptions + incidents
   uv run camai serve sites/*.yaml   # http://127.0.0.1:8000
   ```
   Run `process` on a schedule (or after each recording segment) to keep it current.

## Plug-in points

| What | Today | In your product |
|---|---|---|
| Footage (`Source`) | Recorded files listed in the site YAML | RTSP recorder writing segments, or an `RtspSource` |
| Arming state (`ArmingProvider`) | `armed:` hours in the site YAML (`Site.is_armed`) | Ajax Enterprise API arming state, stored per event |
| Alarms (`AlarmFeed`) | `alarms:` list in the YAML, marked simulated | Ajax Enterprise API alarm events |
| Auth | None (binds to 127.0.0.1) | Put your app's auth in front; scope sites per user |
| Claude | `CAMAI_CLAUDE_BACKEND=subscription` for local testing | `api` with your `ANTHROPIC_API_KEY` |
| Live tiles | MP4 recordings on a replay clock | HLS/WebRTC URL in `CameraTile.segments[].src` |

## What the AI does and doesn't do

- **Haiku 5.5** describes every motion event from ordered frames plus a close-up crop:
  what moved, what they did, what they carried, whether a security uniform or hi-vis is
  visible, and what it couldn't tell. It never identifies people or judges intent.
- **Plain-code rules** (`src/camai/rules.py`) decide severity from the site context: armed
  or not, guard on shift, zones, camera tampering, machinery while armed.
- **Sonnet 5.5** takes a second, deeper look at anything flagged, with zoomed crops around
  the movement. It writes incident and brief headlines, ranks search results and runs the
  lock-up checks.
- Every reason in the app is tagged "AI" or "Rule", so users can see who decided what.

Typical cost at API prices is about $0.001 per described event, plus a few cents a night for
escalations, checks and headlines.

## Privacy notes for Australian customers

- No facial recognition or identification of people.
- Patrol checks report checkpoint coverage per site, not individual guards. Guards must be
  told the cameras check patrol coverage (workplace surveillance notice, which varies by state).
- Footage and descriptions are sent to Anthropic for analysis. Check this against your
  customers' privacy obligations before going live.
