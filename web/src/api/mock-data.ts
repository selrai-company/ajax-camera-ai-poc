/**
 * Mock data for VITE_API_MOCK=1. Models the agreed demo story:
 *  - Ridgeview Apartments, Stage 2: guarded, break-in at 2:14am across 3 cameras, missed patrol
 *    checkpoint, unconfirmed person at 2:31am, generator missing in the morning, repeat ute.
 *  - Hillcrest Plant Yard: unguarded, quiet night, Workshop camera blank from 11:20pm.
 *  - Three small quiet sites so the all-sites view has something to rank.
 * Media points at stand-in clips served by the backend under /media.
 */
import { CLIP_TRACKS } from "./mock-tracks";
import type {
  AiReport,
  Alarm,
  AssetCheck,
  CameraEvent,
  CameraTile,
  HealthItem,
  Incident,
  LockupCheck,
  Media,
  Moment,
  PatrolInsight,
  PatrolRound,
  PatrolVisit,
  Patrols,
  Rule,
  Severity,
  Site,
  Source,
  TrackPoint,
} from "./contract";

// ---------------------------------------------------------------------------
// Time helpers (sites are in Australia/Sydney, AEDT +11:00 in November)
// ---------------------------------------------------------------------------
const OFFSET = "+11:00";
const OFFSET_MIN = 660;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Clock time on a night: times before noon belong to the next calendar day. */
export function isoAt(night: string, hms: string): string {
  const full = hms.length === 5 ? `${hms}:00` : hms;
  const h = Number(full.slice(0, 2));
  return `${h < 12 ? addDays(night, 1) : night}T${full}${OFFSET}`;
}

export function isoFromMs(ms: number): string {
  return new Date(ms + OFFSET_MIN * 60_000).toISOString().slice(0, 19) + OFFSET;
}

const plus = (iso: string, seconds: number) => isoFromMs(Date.parse(iso) + seconds * 1000);

// ---------------------------------------------------------------------------
// Stand-in media catalogue (real files under data/media, served at /media)
// ---------------------------------------------------------------------------
interface Clip {
  path: string;
  frames: number;
  dur: number; // seconds, slightly under the real length
  key: number; // 1-based key frame
}

const C = {
  yardA: { path: "ridgeview/yard/20261111_021340_motion", frames: 7, dur: 17.4, key: 3 },
  yardB: { path: "ridgeview/yard/20261111_021402_motion", frames: 6, dur: 11.4, key: 3 },
  gateUte: { path: "ridgeview/gate_road/20261111_015222_motion", frames: 14, dur: 34.8, key: 5 },
  gateCar: { path: "ridgeview/gate_road/20261111_015210_motion", frames: 6, dur: 5.9, key: 3 },
  laneFox: { path: "ridgeview/laneway/20261111_003200_motion", frames: 16, dur: 79.8, key: 4 },
  backFox: { path: "ridgeview/back_fence/20261111_030500_motion", frames: 10, dur: 24.6, key: 5 },
  lunchDark: { path: "ridgeview/lunch_room/20261111_022030_motion", frames: 10, dur: 24.4, key: 3 },
  office: { path: "ridgeview/site_office/20261111_021705_motion", frames: 6, dur: 15.1, key: 2 },
  streetTruck: { path: "ridgeview/street/20261110_234102_motion", frames: 7, dur: 18.1, key: 3 },
  poleRain: { path: "ridgeview/flood_pole/20261111_041000_motion", frames: 14, dur: 34.4, key: 5 },
  hYard: { path: "hillcrest/yard/20261108_134720_motion", frames: 14, dur: 33.8, key: 5 },
  hGateA: { path: "hillcrest/gate_road/20261108_100200_motion", frames: 6, dur: 7.7, key: 3 },
  hGateB: { path: "hillcrest/gate_road/20261108_100212_motion", frames: 14, dur: 35.1, key: 4 },
  hLunch: { path: "hillcrest/lunch_room/20261108_152000_motion", frames: 10, dur: 24.4, key: 4 },
  hOffice: { path: "hillcrest/site_office/20261108_134819_motion", frames: 6, dur: 15.1, key: 2 },
  hStreet: { path: "hillcrest/street/20261108_113002_motion", frames: 7, dur: 18.1, key: 3 },
} satisfies Record<string, Clip>;

const frameUrl = (c: Clip, i: number) => `/media/${c.path}/frame_${String(i).padStart(2, "0")}.jpg`;

function mediaFor(c: Clip | null): Media {
  if (!c) return { clip: null, frames: [], crop: null, key_frame: null };
  return {
    clip: `/media/${c.path}/clip.mp4`,
    frames: Array.from({ length: c.frames }, (_, i) => frameUrl(c, i + 1)),
    crop: `/media/${c.path}/crop_peak.jpg`,
    key_frame: frameUrl(c, c.key),
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
type Box = [number, number, number, number];

/** A motion track drifting from one box to another over [t0, t1] seconds. */
function drift(from: Box, to: Box, t0: number, t1: number, steps = 5): TrackPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const k = i / steps;
    const box = from.map((v, j) => +(v + (to[j] - v) * k).toFixed(3)) as Box;
    return { t: +(t0 + (t1 - t0) * k).toFixed(2), box };
  });
}

function report(
  o: Partial<AiReport> & Pick<AiReport, "summary" | "activity" | "activity_label">,
): AiReport {
  const r: AiReport = {
    person_present: "no",
    people_count: 0,
    vehicle_present: "no",
    vehicle_types: [],
    items_carried: [],
    movement: "",
    cant_tell: [],
    confidence: "high",
    security_uniform: "no_person",
    hi_vis: "no_person",
    search_text: "",
    model: "claude-haiku-5-5",
    ...o,
  };
  if (!r.search_text) {
    r.search_text = [r.summary, r.activity_label, r.movement, ...r.items_carried, ...r.vehicle_types]
      .join(" ")
      .toLowerCase();
  }
  return r;
}

interface EvSpec {
  key: string;
  cam: string;
  at: string;
  clip: Clip | null;
  kind?: CameraEvent["kind"];
  severity: Severity;
  title: string;
  reasons: [string, Source][];
  report: AiReport | null;
  incident?: string;
  track?: TrackPoint[];
  moments?: Moment[];
  dur?: number;
  dismissed?: boolean;
  delivery?: boolean;
}

interface CamSpec {
  id: string;
  name: string;
  poster: Clip | null;
  posterFrame?: number;
  zones: [string, boolean][];
  checkpoint?: string;
  health?: { status: "blank" | "moved" | "offline"; note: string; since: string };
}

interface IncSpec {
  key: string;
  id: number;
  headline: string;
  headline_by: Source;
  why: [string, Source][];
  cant_tell: string[];
  alarm?: Omit<Alarm, "at"> & { at: string };
  keyFrom: string;
}

interface RoundSpec {
  label: string;
  start: string;
  end: string;
  visits: Record<string, string | "missed" | "unverifiable" | "upcoming">;
}

interface LockSpec {
  cam: string;
  question: string;
  answer: LockupCheck["answer"];
  ok: boolean;
  at: string;
  image: string | null;
  why: string;
}

interface AssetSpec {
  cam: string;
  asset: string;
  evening: { present: "yes" | "no" | "cant_tell"; at: string; image: string | null } | null;
  morning: { present: "yes" | "no" | "cant_tell"; at: string; image: string | null } | null;
  status: AssetCheck["status"];
  text: string;
}

interface NightSpec {
  window: [string, string];
  events: EvSpec[];
  incidents?: IncSpec[];
  lockup: LockSpec[];
  assets?: AssetSpec[];
  rounds?: RoundSpec[];
  insights?: { severity: PatrolInsight["severity"]; text: string; eventKey?: string }[];
  coverage?: number | null;
  headline: string;
  headline_by: Source;
  est_cost_usd: number;
  repeatVehicles?: { description: string; text: string; sightings: { night: string; key: string }[] }[];
  suggestions?: { cam: string; activity: string; eventKey: string; dismissed: number }[];
  /** Extra camera health issues that start this night. */
  health?: Record<string, CamSpec["health"]>;
}

export interface NightData {
  site_id: string;
  night: string;
  window: { start: string; end: string };
  cameras: CameraTile[];
  events: CameraEvent[];
  incidents: Incident[];
  lockup: LockupCheck[];
  assets: AssetCheck[];
  patrols: Patrols | null;
  health: HealthItem[];
  headline: string;
  headline_by: Source;
  est_cost_usd: number;
  deliveryIds: number[];
  repeatVehicles: { description: string; text: string; sightings: { night: string; key: string }[] }[];
  suggestions: { cam: string; activity: string; eventId: number; dismissed: number }[];
  keyToId: Record<string, number>;
}

let nextEventId = 101;

const PRIVACY_NOTE =
  "Patrol checks show site coverage at defined checkpoints for this shift. They don't identify guards, score individuals, or track breaks or phone use.";

function buildNight(site: Site, cams: CamSpec[], night: string, spec: NightSpec): NightData {
  const camName = (id: string) => cams.find((c) => c.id === id)?.name ?? id;
  const sorted = [...spec.events].sort((a, b) => a.at.localeCompare(b.at, "en", { numeric: true }));
  // Sort by real time (times after midnight belong to the next day).
  sorted.sort((a, b) => Date.parse(isoAt(night, a.at)) - Date.parse(isoAt(night, b.at)));

  const keyToId: Record<string, number> = {};
  const incIdByKey: Record<string, number> = {};
  for (const inc of spec.incidents ?? []) incIdByKey[inc.key] = inc.id;

  const events: CameraEvent[] = sorted.map((e) => {
    const id = nextEventId++;
    keyToId[e.key] = id;
    const start = isoAt(night, e.at);
    const dur = e.dur ?? e.clip?.dur ?? 20;
    return {
      id,
      site_id: site.id,
      camera_id: e.cam,
      camera_name: camName(e.cam),
      start,
      end: plus(start, dur),
      kind: e.kind ?? "motion",
      severity: e.severity,
      title: e.title,
      reasons: e.reasons.map(([label, source]) => ({ label, source })),
      report: e.report,
      media: mediaFor(e.clip),
      incident_id: e.incident ? incIdByKey[e.incident] : null,
      dismissed: e.dismissed ?? false,
      // Prefer the track measured from the stand-in footage; whole-frame changes have none.
      track: e.kind === "global_change" || !e.clip ? [] : (CLIP_TRACKS[e.clip.path]?.length ?? 0) > 1 ? CLIP_TRACKS[e.clip.path] : (e.track ?? []),
      moments: e.moments ?? [],
    };
  });
  const byKey = (k: string) => events.find((ev) => ev.id === keyToId[k])!;

  const sevRank: Severity[] = ["needs_look", "unconfirmed", "camera_issue", "fyi", "guard", "ignore"];
  const incidents: Incident[] = (spec.incidents ?? []).map((inc) => {
    const evs = events.filter((ev) => ev.incident_id === inc.id);
    const cameras: Incident["cameras"] = [];
    for (const ev of evs) if (!cameras.some((c) => c.id === ev.camera_id)) cameras.push({ id: ev.camera_id, name: ev.camera_name });
    const severity = sevRank.find((s) => evs.some((ev) => ev.severity === s)) ?? "needs_look";
    return {
      id: inc.id,
      site_id: site.id,
      start: evs[0].start,
      end: evs[evs.length - 1].end,
      severity,
      headline: inc.headline,
      headline_by: inc.headline_by,
      why: inc.why.map(([label, source]) => ({ label, source })),
      cant_tell: inc.cant_tell,
      cameras,
      event_ids: evs.map((ev) => ev.id),
      key_frame: byKey(inc.keyFrom).media.key_frame,
      alarm: inc.alarm ? { ...inc.alarm, at: isoAt(night, inc.alarm.at) } : null,
      status: "open",
    };
  });

  const health = (id: string) => spec.health?.[id] ?? cams.find((c) => c.id === id)?.health;
  const cameras: CameraTile[] = cams.map((c) => {
    const h = health(c.id);
    return {
      id: c.id,
      name: c.name,
      poster: c.poster ? frameUrl(c.poster, c.posterFrame ?? 1) : null,
      segments: events
        .filter((ev) => ev.camera_id === c.id && ev.media.clip)
        .map((ev) => ({ src: ev.media.clip!, start: ev.start, end: ev.end })),
      health: h ? { status: h.status, note: h.note } : { status: "ok", note: null },
      zones: c.zones.map(([name, restricted]) => ({ name, restricted })),
      checkpoint: c.checkpoint ?? null,
    };
  });

  let patrols: Patrols | null = null;
  if (site.guarded && spec.rounds) {
    const checkpoints = cams
      .filter((c) => c.checkpoint)
      .map((c) => ({ id: c.checkpoint!.toLowerCase().replace(/\s+/g, "_"), name: c.checkpoint!, camera_id: c.id }));
    const rounds: PatrolRound[] = spec.rounds.map((r) => {
      const visits: Record<string, PatrolVisit> = {};
      for (const cp of checkpoints) {
        const v = r.visits[cp.id] ?? "missed";
        if (v === "missed" || v === "unverifiable" || v === "upcoming") visits[cp.id] = { status: v, event_id: null, at: null };
        else visits[cp.id] = { status: "visited", event_id: keyToId[v], at: byKey(v).start };
      }
      return { label: r.label, window: { start: isoAt(night, r.start), end: isoAt(night, r.end) }, visits };
    });
    patrols = {
      site_id: site.id,
      night,
      shift: site.guard_shift ? { start: isoAt(night, site.guard_shift.from), end: isoAt(night, site.guard_shift.to) } : null,
      checkpoints,
      rounds,
      insights: (spec.insights ?? []).map((i) => ({
        severity: i.severity,
        text: i.text,
        event_id: i.eventKey ? keyToId[i.eventKey] : null,
      })),
      coverage_pct: spec.coverage ?? null,
      privacy_note: PRIVACY_NOTE,
    };
  }

  const lockup: LockupCheck[] = spec.lockup.map((l) => ({
    camera_id: l.cam,
    camera_name: camName(l.cam),
    question: l.question,
    answer: l.answer,
    ok: l.ok,
    at: isoAt(night, l.at),
    image: l.image,
    why: l.why,
  }));

  const assets: AssetCheck[] = (spec.assets ?? []).map((a) => ({
    camera_id: a.cam,
    camera_name: camName(a.cam),
    asset: a.asset,
    evening: a.evening ? { ...a.evening, at: isoAt(night, a.evening.at) } : null,
    morning: a.morning ? { ...a.morning, at: isoAt(night, a.morning.at) } : null,
    status: a.status,
    text: a.text,
  }));

  const healthItems: HealthItem[] = cams.map((c) => {
    const h = health(c.id);
    return {
      camera_id: c.id,
      camera_name: c.name,
      status: h?.status ?? "ok",
      note: h?.note ?? null,
      since: h ? isoAt(night, h.since) : null,
      image: h ? null : c.poster ? frameUrl(c.poster, c.posterFrame ?? 1) : null,
    };
  });

  return {
    site_id: site.id,
    night,
    window: { start: isoAt(night, spec.window[0]), end: isoAt(night, spec.window[1]) },
    cameras,
    events,
    incidents,
    lockup,
    assets,
    patrols,
    health: healthItems,
    headline: spec.headline,
    headline_by: spec.headline_by,
    est_cost_usd: spec.est_cost_usd,
    deliveryIds: sorted.filter((e) => e.delivery).map((e) => keyToId[e.key]),
    repeatVehicles: spec.repeatVehicles ?? [],
    suggestions: (spec.suggestions ?? []).map((s) => ({
      cam: s.cam,
      activity: s.activity,
      eventId: keyToId[s.eventKey],
      dismissed: s.dismissed,
    })),
    keyToId,
  };
}

// ---------------------------------------------------------------------------
// Reusable event templates
// ---------------------------------------------------------------------------
const guardReport = (where: string) =>
  report({
    summary: `One person in a security uniform with a torch walks the ${where} and checks it.`,
    person_present: "yes",
    people_count: 1,
    activity: "patrolling",
    activity_label: "Walking a patrol",
    movement: `Along the ${where}, then on`,
    security_uniform: "yes",
    hi_vis: "yes",
    search_text: `guard security uniform torch patrol checks ${where} person`,
  });

function guardVisit(key: string, cam: string, at: string, checkpoint: string, where: string, clip: Clip): EvSpec {
  return {
    key,
    cam,
    at,
    clip,
    severity: "guard",
    title: `Guard checked the ${where}`,
    reasons: [
      ["Guard on shift", "rule"],
      ["Security uniform", "ai"],
      [`Checkpoint: ${checkpoint}`, "rule"],
    ],
    report: guardReport(where),
    track: [],
    moments: [{ t: 5.4, label: "Guard checks the checkpoint" }],
  };
}

const ridgeviewRounds = (prefix: string, times: Record<string, [string, string, string, string]>) => {
  const out: EvSpec[] = [];
  for (const [round, [g, b, p, c]] of Object.entries(times)) {
    if (g) out.push(guardVisit(`${prefix}${round}_gate`, "gate_road", g, "Gatehouse", "gatehouse", C.hYard));
    if (b) out.push(guardVisit(`${prefix}${round}_back`, "back_fence", b, "Back fence", "back fence", C.hLunch));
    if (p) out.push(guardVisit(`${prefix}${round}_plant`, "plant_compound", p, "Plant compound", "plant compound", C.hYard));
    if (c) out.push(guardVisit(`${prefix}${round}_cont`, "container_yard", c, "Container yard", "container yard", C.hLunch));
  }
  return out;
};

const laneCar = (key: string, at: string, dismissed: boolean): EvSpec => ({
  key,
  cam: "laneway",
  at,
  clip: C.gateCar,
  severity: "fyi",
  title: "Car drove slowly down the laneway",
  reasons: [
    ["Site armed", "rule"],
    ["Vehicle", "ai"],
  ],
  report: report({
    summary: "A dark sedan drives slowly along the laneway without stopping.",
    vehicle_present: "yes",
    vehicle_types: ["car"],
    activity: "vehicle_passing",
    activity_label: "Vehicle passing",
    movement: "Left to right along the laneway",
  }),
  track: drift([0.55, 0.28, 0.22, 0.16], [0.7, 0.26, 0.2, 0.15], 0, 5.5),
  moments: [{ t: 2, label: "Car passes without stopping" }],
  dismissed,
});

const uteSighting = (key: string, at: string): EvSpec => ({
  key,
  cam: "gate_road",
  at,
  clip: C.gateUte,
  severity: "fyi",
  title: "White ute stopped on the gate road for 2 minutes",
  reasons: [
    ["Site armed", "rule"],
    ["Vehicle stopped near the gate", "ai"],
  ],
  report: report({
    summary: "A white ute pulls up on the gate road with the driver's door open, waits, then drives off. Nobody approaches the gate.",
    vehicle_present: "yes",
    vehicle_types: ["ute"],
    person_present: "cant_tell",
    activity: "vehicle_stopped",
    activity_label: "Vehicle stopped",
    cant_tell: ["Whether anyone got out"],
    confidence: "medium",
  }),
  track: drift([0.0, 0.25, 0.42, 0.72], [0.32, 0.18, 0.55, 0.8], 2, 12),
  moments: [
    { t: 5, label: "Ute stops near the gate" },
    { t: 28, label: "Ute drives off" },
  ],
});

const crew: EvSpec = {
  key: "crew",
  cam: "plant_compound",
  at: "16:40:12",
  clip: C.hYard,
  severity: "ignore",
  title: "Crew in hi-vis moving formwork",
  reasons: [
    ["Site disarmed (work hours)", "rule"],
    ["People in hi-vis", "ai"],
  ],
  report: report({
    summary: "Workers in hi-vis carry formwork panels across the compound to the stack.",
    person_present: "yes",
    people_count: 3,
    activity: "working",
    activity_label: "Working on site",
    items_carried: ["formwork panels"],
    hi_vis: "yes",
    security_uniform: "no",
  }),
  track: [],
  moments: [{ t: 5.2, label: "Crew carries panels to the stack" }],
};

const steel: EvSpec = {
  key: "steel",
  cam: "gate_road",
  at: "15:52:30",
  clip: C.hStreet,
  severity: "ignore",
  title: "Flatbed truck dropped steel at the gate",
  reasons: [
    ["Site disarmed (work hours)", "rule"],
    ["Delivery truck", "ai"],
  ],
  report: report({
    summary: "A flatbed truck towing a trailer pulls up at the gate and unloads bundled steel.",
    vehicle_present: "yes",
    vehicle_types: ["flatbed truck", "trailer"],
    person_present: "yes",
    people_count: 1,
    hi_vis: "yes",
    security_uniform: "no",
    activity: "delivery",
    activity_label: "Delivery",
    search_text: "delivery truck flatbed steel trailer gate unloads",
  }),
  track: drift([0.05, 0.22, 0.5, 0.42], [0.25, 0.22, 0.55, 0.42], 1, 15),
  moments: [{ t: 4, label: "Truck pulls up at the gate" }],
  delivery: true,
};

const delivery: EvSpec = {
  key: "delivery",
  cam: "street",
  at: "17:15:30",
  clip: C.streetTruck,
  severity: "fyi",
  title: "Truck with a trailer pulled up at the frontage",
  reasons: [
    ["Vehicle stopped at the frontage", "ai"],
    ["Late delivery, after 5pm", "rule"],
  ],
  report: report({
    summary: "A truck towing a trailer stops at the site frontage for about six minutes, then leaves.",
    vehicle_present: "yes",
    vehicle_types: ["truck", "trailer"],
    activity: "delivery",
    activity_label: "Delivery",
    movement: "Stops at the frontage, then drives off",
    search_text: "delivery truck trailer arrives frontage stops",
  }),
  track: drift([0.1, 0.3, 0.6, 0.5], [0.3, 0.3, 0.6, 0.5], 1, 16),
  moments: [
    { t: 2, label: "Truck pulls up" },
    { t: 14, label: "Truck leaves" },
  ],
  delivery: true,
};

const foxBack = (key: string, at: string): EvSpec => ({
  key,
  cam: "back_fence",
  at,
  clip: C.backFox,
  severity: "ignore",
  title: "Fox walking along the back fence",
  reasons: [
    ["Animal", "ai"],
    ["No person or vehicle", "rule"],
  ],
  report: report({ summary: "A fox walks along the inside of the back fence.", activity: "animal", activity_label: "Animal" }),
  track: drift([0.58, 0.55, 0.14, 0.16], [0.8, 0.58, 0.14, 0.16], 1, 20),
  moments: [{ t: 8, label: "Fox crosses the frame" }],
});

const foxLane = (key: string, at: string): EvSpec => ({
  key,
  cam: "laneway",
  at,
  clip: C.laneFox,
  severity: "ignore",
  title: "Fox in the laneway",
  reasons: [
    ["Animal", "ai"],
    ["No person or vehicle", "rule"],
  ],
  report: report({ summary: "A fox sits in the laneway, then walks off.", activity: "animal", activity_label: "Animal" }),
  track: drift([0.22, 0.55, 0.22, 0.4], [0.24, 0.55, 0.22, 0.4], 2, 60, 3),
  moments: [{ t: 10, label: "Fox sits in the laneway" }],
});

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------
const NIGHT = "2026-11-10";

export const SITES: Site[] = [
  {
    id: "ridgeview",
    name: "Ridgeview Apartments, Stage 2",
    timezone: "Australia/Sydney",
    address_hint: "Ridgeview, NSW",
    armed: { from: "18:00", to: "06:00", all_day: false },
    guarded: true,
    guard_shift: { from: "18:00", to: "06:00" },
    nights: [NIGHT, addDays(NIGHT, -1), addDays(NIGHT, -2)],
    default_night: NIGHT,
    replay_start: isoAt(NIGHT, "02:13:40"),
    demo: true,
    guard_phone: "+61491570156",
  },
  {
    id: "hillcrest",
    name: "Hillcrest Plant Yard",
    timezone: "Australia/Sydney",
    address_hint: "Hillcrest, NSW",
    armed: { from: "17:00", to: "06:30", all_day: false },
    guarded: false,
    guard_shift: null,
    nights: [NIGHT, addDays(NIGHT, -1)],
    default_night: NIGHT,
    replay_start: isoAt(NIGHT, "23:19:30"),
    demo: true,
  },
  {
    id: "marsden",
    name: "Marsden Park Depot",
    timezone: "Australia/Sydney",
    address_hint: "Marsden Park, NSW",
    armed: { from: "18:00", to: "06:00", all_day: false },
    guarded: false,
    guard_shift: null,
    nights: [NIGHT],
    default_night: NIGHT,
    replay_start: isoAt(NIGHT, "21:11:50"),
    demo: true,
  },
  {
    id: "kellyville",
    name: "Kellyville Townhouses",
    timezone: "Australia/Sydney",
    address_hint: "Kellyville, NSW",
    armed: { from: "17:30", to: "06:30", all_day: false },
    guarded: false,
    guard_shift: null,
    nights: [NIGHT],
    default_night: NIGHT,
    replay_start: isoAt(NIGHT, "21:04:50"),
    demo: true,
  },
  {
    id: "penrith",
    name: "Penrith Civil Works",
    timezone: "Australia/Sydney",
    address_hint: "Penrith, NSW",
    armed: { from: "17:00", to: "06:00", all_day: false },
    guarded: false,
    guard_shift: null,
    nights: [NIGHT],
    default_night: NIGHT,
    replay_start: isoAt(NIGHT, "01:39:50"),
    demo: true,
  },
];
const site = (id: string) => SITES.find((s) => s.id === id)!;

// ---------------------------------------------------------------------------
// Ridgeview Apartments, Stage 2
// ---------------------------------------------------------------------------
const RIDGEVIEW_CAMS: CamSpec[] = [
  { id: "gate_road", name: "Gate road", poster: C.gateUte, zones: [["Site gate", false], ["Gate road", false]], checkpoint: "Gatehouse" },
  { id: "back_fence", name: "Back fence", poster: C.backFox, posterFrame: 2, zones: [["Back fence", true]], checkpoint: "Back fence" },
  { id: "container_yard", name: "Container yard", poster: C.yardB, zones: [["Container", true], ["Yard", false]], checkpoint: "Container yard" },
  { id: "plant_compound", name: "Plant compound", poster: C.hYard, zones: [["Plant compound", true]], checkpoint: "Plant compound" },
  { id: "site_office", name: "Site office", poster: C.office, zones: [["Site office door", true]] },
  { id: "street", name: "Street frontage", poster: C.streetTruck, zones: [["Footpath", false], ["Street", false]] },
  { id: "laneway", name: "Laneway", poster: C.laneFox, zones: [["Laneway", false]] },
  { id: "crane_base", name: "Crane base", poster: C.poleRain, zones: [["Tower crane base", true]] },
];

const ridgeviewLockup = (): LockSpec[] => [
  { cam: "gate_road", question: "Is the site gate closed?", answer: "yes", ok: true, at: "18:00:10", image: frameUrl(C.gateUte, 1), why: "Both gate leaves are shut and the chain is on." },
  { cam: "container_yard", question: "Is the container closed?", answer: "yes", ok: true, at: "18:00:20", image: frameUrl(C.yardB, 1), why: "Container doors are shut with the locking bar down." },
  { cam: "plant_compound", question: "Is the excavator inside the compound?", answer: "yes", ok: true, at: "18:00:30", image: frameUrl(C.hYard, 1), why: "Excavator is parked inside the fenced compound." },
  { cam: "back_fence", question: "Is the perimeter fence intact?", answer: "yes", ok: true, at: "18:00:40", image: frameUrl(C.backFox, 2), why: "Fence panels are upright with no gaps along the visible run." },
  { cam: "site_office", question: "Is the site office door shut?", answer: "yes", ok: true, at: "18:00:50", image: frameUrl(C.office, 1), why: "Door is shut and there's no light inside." },
];

const ridgeviewAssetsOk = (): AssetSpec[] => [
  {
    cam: "plant_compound",
    asset: "Excavator",
    evening: { present: "yes", at: "18:00:30", image: frameUrl(C.hYard, 1) },
    morning: { present: "yes", at: "06:00:30", image: frameUrl(C.hYard, 14) },
    status: "present",
    text: "Excavator was in the compound at 6:00pm and is still there at 6:00am.",
  },
  {
    cam: "container_yard",
    asset: "Portable generator",
    evening: { present: "yes", at: "18:00:20", image: frameUrl(C.yardB, 1) },
    morning: { present: "yes", at: "06:00:20", image: frameUrl(C.yardB, 6) },
    status: "present",
    text: "Portable generator was by the container at 6:00pm and is still there at 6:00am.",
  },
];

const RV_INSIGHT_ALL_COVERED = { severity: "guard" as const, text: "Every round covered every checkpoint." };

function ridgeviewIncidentNight(): NightData {
  const night = NIGHT;
  const events: EvSpec[] = [
    steel,
    crew,
    delivery,
    laneCar("lane_car", "21:31:05", false),
    ...ridgeviewRounds("", {
      r22: ["22:02:40", "22:09:15", "22:15:50", "22:22:30"],
      r00: ["00:01:55", "00:08:20", "00:14:45", "00:21:10"],
      r02: ["02:01:30", "", "02:09:40", "02:05:10"],
      r04: ["04:02:05", "04:08:30", "04:14:20", ""],
    }),
    {
      key: "car_pass",
      cam: "street",
      at: "23:41:02",
      clip: C.gateCar,
      severity: "ignore",
      title: "Car driving past on the street",
      reasons: [
        ["Vehicle passing", "ai"],
        ["Matched your rule: vehicle passing on Street frontage, 10pm to 1am", "rule"],
      ],
      report: report({
        summary: "A car drives past along the street without stopping.",
        vehicle_present: "yes",
        vehicle_types: ["car"],
        activity: "vehicle_passing",
        activity_label: "Vehicle passing",
      }),
      track: drift([0.6, 0.3, 0.2, 0.15], [0.75, 0.28, 0.2, 0.15], 0, 5.5),
      moments: [{ t: 2, label: "Car passes" }],
    },
    {
      key: "fence",
      cam: "back_fence",
      at: "02:14:00",
      clip: C.yardA,
      severity: "needs_look",
      title: "Person climbed over the back fence",
      incident: "breakin",
      reasons: [
        ["Site armed", "rule"],
        ["Restricted zone: Back fence", "rule"],
        ["Person", "ai"],
        ["Climbing a fence", "ai"],
        ["No security uniform", "ai"],
      ],
      report: report({
        summary: "One person climbs over the back fence from outside and drops into the site, then walks towards the container yard.",
        person_present: "yes",
        people_count: 1,
        activity: "climbing_fence",
        activity_label: "Climbing a fence",
        movement: "Over the fence, then towards the container yard",
        cant_tell: ["Whether the fence was damaged"],
        security_uniform: "no",
        hi_vis: "no",
        search_text: "person climbs over back fence drops into site walks towards container yard night intruder",
      }),
      track: [
        { t: 2.0, box: [0.16, 0.0, 0.09, 0.2] },
        { t: 4.0, box: [0.2, 0.0, 0.11, 0.27] },
        { t: 5.8, box: [0.24, 0.0, 0.11, 0.3] },
        { t: 8.5, box: [0.42, 0.0, 0.1, 0.22] },
        { t: 11.6, box: [0.64, 0.0, 0.08, 0.15] },
        { t: 14.5, box: [0.7, 0.0, 0.07, 0.11] },
      ],
      moments: [
        { t: 2, label: "Appears at the fence line" },
        { t: 4, label: "Climbs over the fence" },
        { t: 10, label: "Heads for the container yard" },
      ],
    },
    {
      key: "yard",
      cam: "container_yard",
      at: "02:15:20",
      clip: C.yardB,
      severity: "needs_look",
      title: "Person carried items away from the container",
      incident: "breakin",
      reasons: [
        ["Site armed", "rule"],
        ["Restricted zone: Container", "rule"],
        ["Person", "ai"],
        ["Carrying items", "ai"],
        ["No security uniform", "ai"],
      ],
      report: report({
        summary: "One person walks out of the container yard carrying a bag and a tool case towards the gate road.",
        person_present: "yes",
        people_count: 1,
        activity: "carrying_items",
        activity_label: "Carrying items",
        items_carried: ["bag", "tool case"],
        movement: "From the container towards the gate road",
        cant_tell: ["What is inside the bag"],
        security_uniform: "no",
        hi_vis: "no",
        search_text: "person carrying bag tool case container yard walks towards gate road night",
      }),
      track: [
        { t: 0.0, box: [0.58, 0.0, 0.08, 0.12] },
        { t: 2.3, box: [0.55, 0.0, 0.09, 0.2] },
        { t: 4.6, box: [0.5, 0.0, 0.1, 0.26] },
        { t: 6.9, box: [0.3, 0.12, 0.1, 0.28] },
        { t: 9.2, box: [0.02, 0.32, 0.09, 0.26] },
        { t: 10.8, box: [0.0, 0.36, 0.07, 0.24] },
      ],
      moments: [
        { t: 2.5, label: "Comes out past the container" },
        { t: 5.5, label: "Carrying a bag and tool case" },
        { t: 9, label: "Heads for the gate road" },
      ],
    },
    {
      key: "ute",
      cam: "gate_road",
      at: "02:19:05",
      clip: C.gateUte,
      severity: "needs_look",
      title: "Items loaded into a ute on the gate road",
      incident: "breakin",
      reasons: [
        ["Site armed", "rule"],
        ["Vehicle", "ai"],
        ["Loading a vehicle", "ai"],
        ["Same time window as Back fence and Container yard", "rule"],
      ],
      report: report({
        summary: "A white ute is parked on the gate road with its door open. One person loads items into the tray, then the ute drives off.",
        person_present: "yes",
        people_count: 1,
        vehicle_present: "yes",
        vehicle_types: ["ute"],
        activity: "loading_vehicle",
        activity_label: "Loading a vehicle",
        items_carried: ["tool case"],
        movement: "Ute stops, is loaded, then drives off towards the street",
        cant_tell: ["Number plate not readable in the dark", "Whether a second person was in the ute"],
        confidence: "medium",
        security_uniform: "no",
        hi_vis: "no",
        search_text: "white ute vehicle gate road person loads items tray drives off night",
      }),
      track: [
        { t: 2.5, box: [0.0, 0.28, 0.38, 0.7] },
        { t: 5.0, box: [0.0, 0.22, 0.48, 0.78] },
        { t: 10.0, box: [0.28, 0.18, 0.55, 0.8] },
        { t: 20.0, box: [0.33, 0.17, 0.55, 0.8] },
        { t: 30.0, box: [0.34, 0.17, 0.55, 0.8] },
      ],
      moments: [
        { t: 5, label: "Ute pulls up with the door open" },
        { t: 11, label: "Items loaded into the tray" },
        { t: 28, label: "Ute drives off" },
      ],
    },
    {
      key: "dark",
      cam: "container_yard",
      at: "02:31:20",
      clip: C.lunchDark,
      severity: "unconfirmed",
      title: "Person at the container door in the dark",
      incident: "dark",
      reasons: [
        ["Site armed", "rule"],
        ["Guard on shift", "rule"],
        ["Restricted zone: Container", "rule"],
        ["Person", "ai"],
        ["Uniform: can't tell", "ai"],
      ],
      report: report({
        summary: "One person stands at the container door in near darkness, crouches for a few seconds, then walks off to the right.",
        person_present: "yes",
        people_count: 1,
        activity: "at_door",
        activity_label: "Standing at a door",
        movement: "At the door, crouches, then leaves to the right",
        cant_tell: ["Whether they wore a security uniform (too dark)", "What they did at the door"],
        confidence: "low",
        security_uniform: "cant_tell",
        hi_vis: "cant_tell",
        search_text: "person container door dark crouches walks off unconfirmed",
      }),
      track: [
        { t: 2.4, box: [0.48, 0.2, 0.16, 0.75] },
        { t: 4.9, box: [0.45, 0.15, 0.2, 0.8] },
        { t: 9.8, box: [0.4, 0.52, 0.2, 0.48] },
        { t: 14.7, box: [0.45, 0.2, 0.18, 0.8] },
        { t: 19.6, box: [0.84, 0.35, 0.16, 0.65] },
        { t: 22.0, box: [0.9, 0.4, 0.1, 0.6] },
      ],
      moments: [
        { t: 4, label: "Person at the container door" },
        { t: 10, label: "Crouches at the door" },
        { t: 20, label: "Walks off to the right" },
      ],
    },
    foxBack("fox_back", "03:24:40"),
    foxLane("fox_lane", "03:30:15"),
    {
      key: "rain",
      cam: "crane_base",
      at: "04:10:30",
      clip: C.poleRain,
      kind: "global_change",
      severity: "ignore",
      title: "Rain and wind moving the light",
      reasons: [
        ["Weather", "ai"],
        ["Whole view changed at once", "rule"],
      ],
      report: report({ summary: "Heavy rain streaks past the light pole. Nothing else moves.", activity: "weather", activity_label: "Weather" }),
      track: [],
      moments: [{ t: 6, label: "Rain gust" }],
    },
  ];

  return buildNight(site("ridgeview"), RIDGEVIEW_CAMS, night, {
    window: ["15:30", "07:00"],
    events,
    incidents: [
      {
        key: "breakin",
        id: 7,
        headline: "Person climbed the back fence and carried items to a ute on the gate road. 2:14am, site armed.",
        headline_by: "ai",
        why: [
          ["Site armed", "rule"],
          ["Restricted zone: Container", "rule"],
          ["Person", "ai"],
          ["Climbing a fence", "ai"],
          ["Carrying items", "ai"],
          ["No security uniform", "ai"],
          ["Seen on 3 cameras", "rule"],
        ],
        cant_tell: ["Number plate not readable in the dark", "What the items are"],
        alarm: {
          at: "02:14:06",
          zone: "Back fence PIR",
          verdict: "person_visible",
          verdict_text: "Verified: person visible on Back fence camera",
          simulated: true,
        },
        keyFrom: "fence",
      },
      {
        key: "dark",
        id: 8,
        headline: "Person at the container door at 2:31am while the guard was on shift. Too dark to see a uniform.",
        headline_by: "ai",
        why: [
          ["Site armed", "rule"],
          ["Guard on shift", "rule"],
          ["Restricted zone: Container", "rule"],
          ["Person", "ai"],
          ["Uniform: can't tell", "ai"],
        ],
        cant_tell: ["Whether they wore a security uniform (too dark)"],
        keyFrom: "dark",
      },
    ],
    lockup: ridgeviewLockup(),
    assets: [
      ridgeviewAssetsOk()[0],
      {
        cam: "container_yard",
        asset: "Portable generator",
        evening: { present: "yes", at: "18:00:20", image: frameUrl(C.yardB, 1) },
        morning: { present: "no", at: "06:00:20", image: frameUrl(C.yardB, 6) },
        status: "missing",
        text: "Portable generator was by the container at 6:00pm and isn't there at 6:00am.",
      },
    ],
    rounds: [
      { label: "10:00pm round", start: "22:00", end: "22:45", visits: { gatehouse: "r22_gate", back_fence: "r22_back", plant_compound: "r22_plant", container_yard: "r22_cont" } },
      { label: "Midnight round", start: "00:00", end: "00:45", visits: { gatehouse: "r00_gate", back_fence: "r00_back", plant_compound: "r00_plant", container_yard: "r00_cont" } },
      { label: "2:00am round", start: "02:00", end: "02:45", visits: { gatehouse: "r02_gate", back_fence: "missed", plant_compound: "r02_plant", container_yard: "r02_cont" } },
      { label: "4:00am round", start: "04:00", end: "04:45", visits: { gatehouse: "r04_gate", back_fence: "r04_back", plant_compound: "r04_plant", container_yard: "unverifiable" } },
    ],
    insights: [
      { severity: "fyi", text: "2:00am round: Back fence not visited." },
      { severity: "fyi", text: "Back fence went 4 hours without a confirmed visit (12:08am to 4:08am).", eventKey: "r04_back" },
      { severity: "fyi", text: "4:00am round: Container yard couldn't be checked. Rain on the lens." },
      { severity: "guard", text: "10:00pm and midnight rounds covered every checkpoint.", eventKey: "r22_gate" },
    ],
    coverage: 88,
    headline: "Break-in at 2:14am: someone climbed the back fence and loaded items into a ute. The portable generator is missing this morning.",
    headline_by: "ai",
    est_cost_usd: 0.041,
    repeatVehicles: [
      {
        description: "White ute",
        text: "White ute seen near Gate road on 3 nights while armed",
        sightings: [
          { night: addDays(NIGHT, -2), key: "ute_seen" },
          { night: addDays(NIGHT, -1), key: "ute_seen" },
          { night: NIGHT, key: "ute" },
        ],
      },
    ],
    suggestions: [{ cam: "laneway", activity: "vehicle_passing", eventKey: "lane_car", dismissed: 3 }],
  });
}

function ridgeviewQuietNight(night: string, uteAt: string, laneCars: string[]): NightData {
  const events: EvSpec[] = [
    { ...crew, at: "16:35:40" },
    { ...delivery, at: "16:20:10", severity: "ignore", reasons: [["Site disarmed (work hours)", "rule"], ["Delivery truck", "ai"]] },
    ...laneCars.map((t, i) => laneCar(`lane_car_${i}`, t, true)),
    ...ridgeviewRounds("", {
      r22: ["22:03:10", "22:10:05", "22:16:30", "22:23:00"],
      r00: ["00:02:20", "00:09:10", "00:15:40", "00:22:15"],
      r02: ["02:02:05", "02:08:45", "02:15:30", "02:21:50"],
      r04: ["04:01:40", "04:08:10", "04:14:55", "04:21:30"],
    }),
    uteSighting("ute_seen", uteAt),
    foxLane("fox_lane", "03:12:00"),
  ];
  const visits = (r: string) => ({ gatehouse: `${r}_gate`, back_fence: `${r}_back`, plant_compound: `${r}_plant`, container_yard: `${r}_cont` });
  return buildNight(site("ridgeview"), RIDGEVIEW_CAMS, night, {
    window: ["15:30", "07:00"],
    events,
    lockup: ridgeviewLockup(),
    assets: ridgeviewAssetsOk(),
    rounds: [
      { label: "10:00pm round", start: "22:00", end: "22:45", visits: visits("r22") },
      { label: "Midnight round", start: "00:00", end: "00:45", visits: visits("r00") },
      { label: "2:00am round", start: "02:00", end: "02:45", visits: visits("r02") },
      { label: "4:00am round", start: "04:00", end: "04:45", visits: visits("r04") },
    ],
    insights: [RV_INSIGHT_ALL_COVERED],
    coverage: 100,
    headline: `Nothing needed a look. A white ute stopped on the gate road for 2 minutes at ${uteAt.startsWith("23") ? "11:48pm" : "1:12am"}.`,
    headline_by: "rule",
    est_cost_usd: 0.028,
  });
}

// ---------------------------------------------------------------------------
// Hillcrest Plant Yard
// ---------------------------------------------------------------------------
const HILLCREST_CAMS: CamSpec[] = [
  { id: "front_gate", name: "Front gate", poster: C.hGateB, zones: [["Gate", false]] },
  { id: "plant_yard", name: "Plant yard", poster: C.hYard, zones: [["Plant yard", true]] },
  { id: "workshop", name: "Workshop", poster: C.hOffice, zones: [["Workshop door", true]] },
  { id: "amenities", name: "Amenities", poster: C.hLunch, zones: [["Amenities door", false]] },
  { id: "street", name: "Street frontage", poster: C.hStreet, zones: [["Street", false]] },
];

function hillcrestNight(night: string, blank: boolean): NightData {
  const events: EvSpec[] = [
    {
      key: "last_ute",
      cam: "front_gate",
      at: "16:52:10",
      clip: C.hGateB,
      severity: "ignore",
      title: "Last ute leaving through the gate",
      reasons: [
        ["Site disarmed (work hours)", "rule"],
        ["Vehicle leaving", "ai"],
      ],
      report: report({ summary: "A ute with its door open stops at the gate, then drives out.", vehicle_present: "yes", vehicle_types: ["ute"], activity: "vehicle_leaving", activity_label: "Vehicle leaving" }),
      track: drift([0.0, 0.3, 0.4, 0.6], [0.3, 0.2, 0.5, 0.75], 2, 14),
      moments: [{ t: 4, label: "Ute stops at the gate" }],
    },
    {
      key: "lock_amen",
      cam: "amenities",
      at: "16:58:30",
      clip: C.hLunch,
      severity: "ignore",
      title: "Worker locking the amenities door",
      reasons: [
        ["Site disarmed (work hours)", "rule"],
        ["Person", "ai"],
      ],
      report: report({
        summary: "One person with a backpack locks the amenities door and leaves.",
        person_present: "yes",
        people_count: 1,
        security_uniform: "no",
        hi_vis: "no",
        activity: "at_door",
        activity_label: "Standing at a door",
      }),
      track: [],
      moments: [{ t: 5.4, label: "Locks the door" }],
    },
    {
      key: "truck_pass",
      cam: "street",
      at: "19:42:05",
      clip: C.hStreet,
      severity: "ignore",
      title: "Truck with a trailer driving past",
      reasons: [
        ["Vehicle passing", "ai"],
        ["Matched your rule: vehicle passing on Street frontage, 5pm to 6am", "rule"],
      ],
      report: report({ summary: "A truck towing a trailer drives past without stopping.", vehicle_present: "yes", vehicle_types: ["truck", "trailer"], activity: "vehicle_passing", activity_label: "Vehicle passing" }),
      track: drift([0.05, 0.25, 0.5, 0.45], [0.35, 0.25, 0.5, 0.45], 1, 15),
      moments: [{ t: 3, label: "Truck passes" }],
    },
    {
      key: "headlights",
      cam: "front_gate",
      at: "01:12:40",
      clip: C.hGateA,
      kind: "global_change",
      severity: "ignore",
      title: "Headlights swept across the gate",
      reasons: [["Lighting change only", "rule"]],
      report: null,
      track: [],
      moments: [],
    },
  ];
  if (blank) {
    events.push({
      key: "blank",
      cam: "workshop",
      at: "23:20:00",
      clip: null,
      kind: "blank_view",
      severity: "camera_issue",
      title: "Camera view went blank",
      reasons: [["View blank for more than 10 minutes", "rule"]],
      report: null,
      dur: 7 * 3600 + 600,
    });
  }
  return buildNight(site("hillcrest"), HILLCREST_CAMS, night, {
    window: ["15:30", "07:30"],
    events,
    lockup: [
      { cam: "front_gate", question: "Is the site gate closed?", answer: "yes", ok: true, at: "17:00:10", image: frameUrl(C.hGateB, 1), why: "Gate is shut and padlocked." },
      { cam: "workshop", question: "Is the workshop roller door down?", answer: "yes", ok: true, at: "17:00:20", image: frameUrl(C.hOffice, 1), why: "Roller door is fully down." },
      { cam: "plant_yard", question: "Is the perimeter fence intact?", answer: "yes", ok: true, at: "17:00:30", image: frameUrl(C.hYard, 1), why: "Fence line is continuous along the yard." },
      { cam: "amenities", question: "Is the amenities door shut?", answer: "yes", ok: true, at: "17:00:40", image: frameUrl(C.hLunch, 1), why: "Door is shut, lights off." },
    ],
    assets: [
      {
        cam: "plant_yard",
        asset: "Smooth drum roller",
        evening: { present: "yes", at: "17:00:30", image: frameUrl(C.hYard, 1) },
        morning: { present: "yes", at: "06:30:30", image: frameUrl(C.hYard, 14) },
        status: "present",
        text: "Smooth drum roller was in the yard at 5:00pm and is still there at 6:30am.",
      },
      {
        cam: "workshop",
        asset: "Welder trailer",
        evening: { present: "yes", at: "17:00:20", image: frameUrl(C.hOffice, 1) },
        morning: blank ? { present: "cant_tell", at: "06:30:20", image: null } : { present: "yes", at: "06:30:20", image: frameUrl(C.hOffice, 6) },
        status: blank ? "unclear" : "present",
        text: blank
          ? "Welder trailer was by the workshop at 5:00pm. Can't check this morning because the camera is blank."
          : "Welder trailer was by the workshop at 5:00pm and is still there at 6:30am.",
      },
    ],
    health: blank
      ? { workshop: { status: "blank", note: "View went blank at 11:20pm and hasn't come back. Check the power, or whether the lens is covered.", since: "23:20:00" } }
      : undefined,
    headline: blank
      ? "Quiet night. Nothing needed a look. The Workshop camera went blank at 11:20pm."
      : "Quiet night. Nothing needed a look.",
    headline_by: "rule",
    est_cost_usd: 0.012,
  });
}

// ---------------------------------------------------------------------------
// Small quiet sites (for the all-sites view)
// ---------------------------------------------------------------------------
function quietSite(
  id: string,
  cams: CamSpec[],
  events: EvSpec[],
  lockup: LockSpec[],
  headline: string,
  windowSpec: [string, string],
): NightData {
  return buildNight(site(id), cams, NIGHT, {
    window: windowSpec,
    events,
    lockup,
    headline,
    headline_by: "rule",
    est_cost_usd: 0.006,
  });
}

function marsden(): NightData {
  const cams: CamSpec[] = [
    { id: "depot_gate", name: "Depot gate", poster: C.gateCar, zones: [["Gate", false]] },
    { id: "workshop", name: "Workshop", poster: C.office, zones: [["Workshop", true]] },
    { id: "fuel_bay", name: "Fuel bay", poster: C.poleRain, zones: [["Fuel bay", true]] },
    { id: "yard", name: "Truck yard", poster: C.hYard, posterFrame: 3, zones: [["Truck yard", false]] },
  ];
  return quietSite(
    "marsden",
    cams,
    [{ ...uteSighting("gate_ute", "21:12:00"), cam: "depot_gate", title: "Ute stopped at the depot gate for a minute, then left" }],
    [
      { cam: "depot_gate", question: "Is the depot gate closed?", answer: "yes", ok: true, at: "18:00:10", image: frameUrl(C.gateCar, 1), why: "Gate is shut." },
      { cam: "fuel_bay", question: "Is the fuel bay cage locked?", answer: "yes", ok: true, at: "18:00:20", image: frameUrl(C.poleRain, 1), why: "Cage door is closed." },
    ],
    "Nothing needed a look. A ute stopped at the depot gate for a minute at 9:12pm.",
    ["15:30", "07:00"],
  );
}

function kellyville(): NightData {
  const cams: CamSpec[] = [
    { id: "entry", name: "Site entry", poster: C.hGateA, zones: [["Entry", false]] },
    { id: "lot_7", name: "Lot 7", poster: C.hYard, posterFrame: 8, zones: [["Lot 7 slab", false]] },
    { id: "materials", name: "Materials store", poster: C.hLunch, zones: [["Materials", true]] },
  ];
  return quietSite(
    "kellyville",
    cams,
    [
      {
        key: "turn",
        cam: "entry",
        at: "21:05:00",
        clip: C.hGateA,
        severity: "ignore",
        title: "Car turned around at the entry",
        reasons: [
          ["Vehicle turning", "ai"],
          ["Didn't stop or enter", "rule"],
        ],
        report: report({ summary: "A car turns around in the entry and drives away.", vehicle_present: "yes", vehicle_types: ["car"], activity: "vehicle_turning", activity_label: "Vehicle turning" }),
        track: drift([0.6, 0.25, 0.3, 0.3], [0.2, 0.25, 0.3, 0.3], 0, 7),
      },
    ],
    [
      { cam: "entry", question: "Is the site gate closed?", answer: "yes", ok: true, at: "17:30:10", image: frameUrl(C.hGateA, 1), why: "Temporary fence gate is closed." },
      { cam: "materials", question: "Is the materials store shut?", answer: "yes", ok: true, at: "17:30:20", image: frameUrl(C.hLunch, 1), why: "Door is shut." },
    ],
    "Quiet night. Nothing needed a look.",
    ["15:30", "07:00"],
  );
}

function penrith(): NightData {
  const cams: CamSpec[] = [
    { id: "compound", name: "Compound", poster: C.hYard, posterFrame: 12, zones: [["Compound", true]] },
    { id: "light_tower", name: "Light tower", poster: C.poleRain, zones: [["Trench works", true]] },
    { id: "access_road", name: "Access road", poster: C.hStreet, zones: [["Access road", false]] },
  ];
  return quietSite(
    "penrith",
    cams,
    [
      {
        key: "rain",
        cam: "light_tower",
        at: "01:40:00",
        clip: C.poleRain,
        kind: "global_change",
        severity: "ignore",
        title: "Rain moving across the light",
        reasons: [
          ["Weather", "ai"],
          ["Whole view changed at once", "rule"],
        ],
        report: report({ summary: "Rain streaks past the light tower. Nothing else moves.", activity: "weather", activity_label: "Weather" }),
      },
    ],
    [
      { cam: "compound", question: "Is the compound gate closed?", answer: "yes", ok: true, at: "17:00:10", image: frameUrl(C.hYard, 12), why: "Gate is closed and chained." },
      { cam: "light_tower", question: "Are the trench plates in place?", answer: "yes", ok: true, at: "17:00:20", image: frameUrl(C.poleRain, 1), why: "Plates cover the open trench." },
    ],
    "Quiet night. Nothing needed a look.",
    ["15:30", "07:00"],
  );
}

// ---------------------------------------------------------------------------
// Assemble (Ridgeview's incident night first so its ids start at 101)
// ---------------------------------------------------------------------------
const built: NightData[] = [
  ridgeviewIncidentNight(),
  ridgeviewQuietNight(addDays(NIGHT, -1), "23:48:10", ["20:40:30", "22:15:05"]),
  ridgeviewQuietNight(addDays(NIGHT, -2), "01:12:30", ["21:05:45"]),
  hillcrestNight(NIGHT, true),
  hillcrestNight(addDays(NIGHT, -1), false),
  marsden(),
  kellyville(),
  penrith(),
];

export const NIGHTS: Record<string, NightData> = Object.fromEntries(built.map((n) => [`${n.site_id}|${n.night}`, n]));

export const INITIAL_RULES: Rule[] = [
  {
    id: 1,
    site_id: "ridgeview",
    camera_id: "street",
    activity: "vehicle_passing",
    hour_from: 22,
    hour_to: 0,
    note: "Hide 'vehicle passing' on Street frontage between 22:00 and 00:59 every night",
    created_at: "2026-10-28T09:12:00+11:00",
  },
  {
    id: 2,
    site_id: "hillcrest",
    camera_id: "street",
    activity: "vehicle_passing",
    hour_from: 17,
    hour_to: 6,
    note: "Hide 'vehicle passing' on Street frontage between 17:00 and 06:59 every night",
    created_at: "2026-10-30T07:40:00+11:00",
  },
];

export const CAMERA_NAMES: Record<string, Record<string, string>> = {
  ridgeview: Object.fromEntries(RIDGEVIEW_CAMS.map((c) => [c.id, c.name])),
  hillcrest: Object.fromEntries(HILLCREST_CAMS.map((c) => [c.id, c.name])),
};
