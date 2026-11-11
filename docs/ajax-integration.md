# Connecting real Ajax cameras (next step)

The proof of concept reads recorded files. Moving to live Ajax cameras changes only the
input side (`src/camai/ingest.py`); the gate, rules, AI and brief stay the same.

| Need | Where it comes from | Status |
|---|---|---|
| Live video | Ajax cameras/NVR over RTSP / ONVIF. The Ajax apps can generate RTSP links for main and secondary streams. | Check against current firmware: one TurretCam page says it is not formally ONVIF-conformant. |
| Person/vehicle detection | Ajax cameras send their on-camera AI events. Use them as a free first filter alongside the motion gate. | Confirm the event format on their hardware. |
| Armed / disarmed state, alarm events | Ajax Enterprise API (partners). Replaces the fixed armed hours in the site YAML. | Access unconfirmed. This is the strongest risk signal, so worth chasing first. |

Suggested order:
1. `RtspSource` that records rolling segments to disk and runs the same gate.
2. Pull arming state from the Enterprise API into `rules.evaluate` (replacing `armed:` hours).
3. Live alarm check: when an Ajax alarm fires, describe the last 30 seconds and push the result.

Sources: Ajax ONVIF support blog, Ajax "integrate video surveillance into CMS" support
article, TurretCam product page, Ajax "What is Enterprise API".
