# Adding TypeSafe Jev to the checks comparison

`camai check` asks a fixed question ("Is the gate open?") about one or more images using
every checker that is configured. Today that is Haiku 5.5. Jev slots in beside it.

## Why Jev is here
Jev is a decision model: it returns a choice with a confidence score instead of text.
That score can be thresholded per site, which a self-reported "high/medium/low" from an
LLM can't really do. Jev can't write descriptions, so the event reports and the morning
brief stay on Claude.

## Status (Nov 2026)
- Image input arrived in Jev 1.13/1.14 and is **experimental**: it needs the request
  header `TypeSafe-Danger-Zone-Images: true`, and TypeSafe says image results are not yet
  reliable enough to vouch for in production.
- Images: PNG/JPEG, 280–1,568 px per side, 16 MiB each, 32 MiB per request. One bad image
  fails the whole request. EXIF orientation is ignored.
- Box questions return one object's bounding box with a confidence score, but always return
  a box even when nothing is there, so pair them with a yes/no question first.
- Access may be waitlisted. It is also listed on Vercel's AI Gateway as `typesafe-ai/jev-1.14.0`.

## Wiring it in
1. Get access and set `JEV_API_KEY` (and `JEV_BASE_URL`) in `.env`.
2. Fill in `JevChecker.check` in `src/camai/checks.py` from TypeSafe's API docs: one choice
   question with the options plus `cant_tell`, the images, and the experimental header. Map
   Jev's confidence straight into `CheckResult.confidence`.
3. Run the same questions on the same labelled frames with both checkers and compare
   accuracy at a fixed false-alarm rate, per camera, especially on night/IR footage.
4. Test stability: send the same frame twice and with a small crop, resize or JPEG change.
   If the score swings, per-site thresholds won't hold.

Only switch a check to Jev if it clearly beats Haiku on *your* footage.
