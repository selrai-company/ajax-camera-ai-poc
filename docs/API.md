# camai API v1

The JSON service behind the camera wall, incidents, search, brief and patrols. Types are in
`web/src/api/types.ts` (the contract). All times are ISO 8601 with the site's UTC offset.
Media URLs are served under `/media/...`.

A "night" is named by the date it starts on: night `2026-11-10` runs from that afternoon
until the next morning (the site's armed window, padded).

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v1/sites` | `Site[]` |
| GET | `/api/v1/sites/{site}/wall?night=` | `Wall` (cameras with recordings, events, incidents) |
| GET | `/api/v1/sites/{site}/brief?night=` | `Brief` |
| GET | `/api/v1/sites/{site}/incidents?night=&status=` | `Incident[]` |
| GET | `/api/v1/incidents/{id}` | `IncidentDetail` |
| POST | `/api/v1/incidents/{id}/status` body `{"status": "handled" \| "open"}` | `Incident` |
| GET | `/api/v1/incidents/{id}/evidence.pdf` | PDF evidence pack |
| POST | `/api/v1/events/{id}/dismiss` | `CameraEvent` (this event only, no rule) |
| GET | `/api/v1/events/{id}/rule-preview` | `RulePreview` (what a recurring rule would hide) |
| POST | `/api/v1/rules` body `{"event_id": 12}` | `Rule` |
| GET | `/api/v1/sites/{site}/rules` | `Rule[]` |
| DELETE | `/api/v1/rules/{id}` | `{"ok": true}` |
| POST | `/api/v1/search` body `{"site_id": "...", "night": null, "q": "..."}` | `SearchResponse` |
| GET | `/api/v1/sites/{site}/patrols?night=` | `Patrols` |
| GET | `/api/v1/sites/{site}/health?night=` | `HealthItem[]` |

Mutations (POST, DELETE) require the header `X-Camai: 1`. This only blocks cross-site
requests; it is not authentication. Put the host app's auth in front of this service
(see `INTEGRATION.md`).

## v1.1 additions

- Every `CameraEvent` also has `track: TrackPoint[]` (where the movement is over the clip) and
  `moments: Moment[]` (AI-marked moments). Draw the track box over the video in sync with
  `currentTime`; label it with the event title.
- `Brief` also has `deliveries`, `assets`, `repeat_vehicles` and `suggestions` (see `BriefExtras`).
- `GET /api/v1/portfolio?night=` returns `PortfolioSite[]`, ranked most urgent first.
