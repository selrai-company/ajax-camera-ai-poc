/**
 * API contract v1 between the camai backend (FastAPI, /api/v1) and any frontend.
 * The backend must return exactly these shapes. Times are ISO 8601 strings with the
 * site's UTC offset (e.g. "2026-11-11T02:14:00+11:00"). Media paths are URLs under /media.
 */

export type Severity = "needs_look" | "unconfirmed" | "fyi" | "guard" | "camera_issue" | "ignore";
// needs_look   red    something a person should look at now
// unconfirmed  amber  person while armed whose authorisation can't be confirmed (e.g. dark, maybe the guard)
// fyi          amber  worth knowing (vehicle while armed, delivery)
// guard        blue   rostered guard on patrol (shift active + security uniform seen)
// camera_issue amber  camera blank, covered or moved
// ignore       grey   checked and ignored (animal, weather, disarmed work hours, matched rule)

export type Source = "ai" | "rule";

export interface Reason {
  label: string; // "Site armed", "Person", "Carrying items", "Restricted zone: Container"
  source: Source; // who said it: the AI description or a plain-code rule
}

export interface Media {
  clip: string | null; // short mp4 of just this event
  frames: string[]; // the ordered frames the AI looked at
  crop: string | null; // close-up of the moving area
  key_frame: string | null; // best single frame (from the AI's evidence_frames)
}

export interface AiReport {
  summary: string;
  person_present: "yes" | "no" | "cant_tell";
  people_count: number;
  vehicle_present: "yes" | "no" | "cant_tell";
  vehicle_types: string[];
  activity: string; // enum on the backend; display via `activity_label`
  activity_label: string; // human label, e.g. "Climbing a fence"
  items_carried: string[];
  movement: string;
  cant_tell: string[];
  confidence: "low" | "medium" | "high";
  security_uniform: "yes" | "no" | "cant_tell" | "no_person";
  hi_vis: "yes" | "no" | "cant_tell" | "no_person";
  search_text: string;
  model: string; // "claude-haiku-5-5"
}

export interface CameraEvent {
  id: number;
  site_id: string;
  camera_id: string;
  camera_name: string;
  start: string; // ISO
  end: string; // ISO
  kind: "motion" | "global_change" | "blank_view";
  severity: Severity;
  title: string; // one line, sentence case, no camera name or time
  reasons: Reason[];
  report: AiReport | null; // null when the AI didn't look (lighting flash, blank view)
  media: Media;
  incident_id: number | null;
  dismissed: boolean; // dismissed by a person ("not a problem, just this once")
}

export interface Alarm {
  at: string; // ISO
  zone: string; // "Back fence PIR"
  verdict: "person_visible" | "vehicle_visible" | "nothing_visible" | "unclear";
  verdict_text: string; // "Verified: person visible on Back fence camera"
  simulated: boolean; // true until the Ajax Enterprise API is connected
}

export interface Incident {
  id: number;
  site_id: string;
  start: string;
  end: string;
  severity: Severity; // highest severity among its events
  headline: string; // AI-written one sentence, "same time window" wording, never "same person"
  headline_by: Source; // "ai" when Sonnet wrote it, "rule" when the plain fallback was used
  why: Reason[]; // merged, de-duplicated reasons across events
  cant_tell: string[];
  cameras: { id: string; name: string }[]; // in order of first appearance
  event_ids: number[];
  key_frame: string | null;
  alarm: Alarm | null;
  status: "open" | "handled" | "dismissed";
}

export interface IncidentDetail extends Incident {
  events: CameraEvent[];
}

export interface Segment {
  src: string; // mp4 URL
  start: string; // wall-clock time the recording starts
  end: string;
}

export interface CameraTile {
  id: string;
  name: string;
  poster: string | null; // still frame for idle display
  segments: Segment[]; // recordings for the selected night, in time order
  health: { status: "ok" | "blank" | "moved" | "offline"; note: string | null };
  zones: { name: string; restricted: boolean }[];
  checkpoint: string | null; // guard checkpoint name if this camera covers one
}

export interface Site {
  id: string;
  name: string;
  timezone: string; // "Australia/Sydney"
  address_hint: string | null; // "Ridgeview, NSW" (demo)
  armed: { from: string; to: string; all_day: boolean }; // "18:00", "06:00"
  guarded: boolean;
  guard_shift: { from: string; to: string } | null;
  nights: string[]; // available nights, "2026-11-10" = the night starting that evening
  default_night: string;
  replay_start: string; // ISO time the demo replay opens at (e.g. just before the incident)
  demo: boolean; // true when footage is recorded stand-in clips
}

export interface Wall {
  site_id: string;
  night: string;
  window: { start: string; end: string }; // the night's span
  cameras: CameraTile[];
  events: CameraEvent[]; // all events in the window, any severity, time order
  incidents: Incident[];
}

export interface LockupCheck {
  camera_id: string;
  camera_name: string;
  question: string; // "Is the site gate closed?"
  answer: "yes" | "no" | "cant_tell";
  ok: boolean; // answer matches the expected locked-up state
  at: string;
  image: string | null;
  why: string; // AI's short reason
}

export interface PatrolVisit {
  status: "visited" | "missed" | "unverifiable" | "upcoming";
  event_id: number | null;
  at: string | null;
}

export interface PatrolRound {
  label: string; // "10:00pm round"
  window: { start: string; end: string };
  visits: Record<string, PatrolVisit>; // keyed by checkpoint id
}

export interface PatrolInsight {
  severity: "needs_look" | "fyi" | "guard";
  text: string; // "2:00am round: Back fence not visited"
  event_id: number | null;
}

export interface Patrols {
  site_id: string;
  night: string;
  shift: { start: string; end: string } | null;
  checkpoints: { id: string; name: string; camera_id: string }[];
  rounds: PatrolRound[];
  insights: PatrolInsight[];
  coverage_pct: number | null; // visited / due, rounds already finished
  privacy_note: string;
}

export interface Brief {
  site_id: string;
  night: string;
  status: "needs_look" | "fyi" | "camera_issue" | "all_good";
  headline: string;
  headline_by: Source;
  incidents: Incident[]; // needs a look first
  fyi: CameraEvent[];
  ignored: { count: number; reasons: Record<string, number> };
  lockup: LockupCheck[];
  patrol: { coverage_pct: number | null; missed: PatrolInsight[] } | null;
  health: { camera_id: string; camera_name: string; status: string; note: string | null }[];
  est_cost_usd: number;
}

export interface SearchResult {
  event: CameraEvent;
  why: string; // "Matches: tipper truck arriving at the gate"
  highlights: string[]; // words to highlight in the event text
  checked_on_frames: boolean; // the top results get re-checked against the frames
  frame_check: "confirmed" | "not_confirmed" | null;
}

export interface SearchResponse {
  query: string;
  interpreted: {
    cameras: string[];
    start: string | null;
    end: string | null;
    subjects: string[]; // "person", "vehicle", "excavator"
    keywords: string[];
    summary: string; // "People near the container, 10pm to 6am, Ridgeview"
  };
  answer: string | null; // one-sentence answer with event ids cited as [#12]
  results: SearchResult[];
  note: string | null; // e.g. "This system doesn't identify people."
  est_cost_usd: number;
}

export interface Rule {
  id: number;
  site_id: string;
  camera_id: string;
  activity: string;
  hour_from: number;
  hour_to: number;
  note: string;
  created_at: string;
}

export interface RulePreview {
  event_id: number;
  rule: Omit<Rule, "id" | "created_at">;
  description: string; // "Hide 'vehicle passing' on Street frontage between 22:00 and 00:59 every night"
  would_hide: number; // matching events in the stored history
  caveat: string | null; // "A person seen while armed still shows as Unconfirmed"
}

export interface HealthItem {
  camera_id: string;
  camera_name: string;
  status: "ok" | "blank" | "moved" | "offline";
  note: string | null;
  since: string | null;
  image: string | null;
}

// ---------------------------------------------------------------------------
// Additions (v1.1): on-video annotations and the extra insight features.
// ---------------------------------------------------------------------------

/** Where the movement is, over time. t = seconds from the start of the event clip
 * (CameraEvent.start). box = normalised [x, y, w, h] in 0..1 of the video frame.
 * Comes from the motion detector, so label it "Movement" plus the AI's title, never "person". */
export interface TrackPoint {
  t: number;
  box: [number, number, number, number];
}

/** AI-marked moments inside an event clip (from the frames the AI said best show what happened). */
export interface Moment {
  t: number; // seconds from CameraEvent.start
  label: string; // "Climbs the fence", "Carries items to the ute"
}

// CameraEvent gains (always present from the backend; may be empty arrays):
//   track: TrackPoint[]
//   moments: Moment[]
export interface CameraEventAnnotations {
  track: TrackPoint[];
  moments: Moment[];
}

export interface AssetSnapshot {
  present: "yes" | "no" | "cant_tell";
  at: string;
  image: string | null;
}

/** "Is the excavator in the compound?" asked at lock-up and again in the morning. */
export interface AssetCheck {
  camera_id: string;
  camera_name: string;
  asset: string; // "Excavator"
  evening: AssetSnapshot | null;
  morning: AssetSnapshot | null;
  status: "present" | "missing" | "arrived" | "unclear";
  text: string; // "Excavator was in the compound at 6:00pm and isn't at 6:00am"
}

/** Same kind of vehicle seen while armed on more than one night: possible casing. Vehicles only, no plates. */
export interface RepeatVehicle {
  description: string; // "White ute"
  nights: string[];
  sightings: { event_id: number; at: string; camera_name: string; image: string | null }[];
  text: string; // "White ute seen near Gate road on 3 nights while armed"
}

/** After the same kind of event is dismissed 3 times, suggest a rule instead of asking again. */
export interface RuleSuggestion {
  camera_id: string;
  camera_name: string;
  activity_label: string;
  dismissed_count: number;
  preview: RulePreview;
}

// Brief gains:
//   deliveries: CameraEvent[]        deliveries / trucks arriving in work hours, with stills
//   assets: AssetCheck[]
//   repeat_vehicles: RepeatVehicle[]
//   suggestions: RuleSuggestion[]
export interface BriefExtras {
  deliveries: CameraEvent[];
  assets: AssetCheck[];
  repeat_vehicles: RepeatVehicle[];
  suggestions: RuleSuggestion[];
}

/** One row per site for the all-sites triage page (ops team / owner with many sites). */
export interface PortfolioSite {
  site: Site;
  night: string;
  status: Brief["status"];
  headline: string;
  open_incidents: number;
  unconfirmed: number;
  missed_rounds: number;
  camera_issues: number;
  lockup_ok: boolean | null;
  assets_missing: number;
  key_frame: string | null;
  rank_reason: string; // "Break-in in progress window, 2 missed rounds"
}
