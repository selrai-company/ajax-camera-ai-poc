/**
 * In-browser mock of the camai API (VITE_API_MOCK=1). Same function shapes as the real client,
 * typed against the contract, with in-memory state so actions (mark handled, dismiss, rules)
 * behave like the real thing until the page reloads.
 */
import type { Api } from "./client";
import { ApiError } from "./client";
import type {
  Brief,
  CameraEvent,
  Incident,
  IncidentDetail,
  PortfolioSite,
  Rule,
  RulePreview,
  RuleSuggestion,
  SearchResponse,
  SearchResult,
  Site,
  Wall,
} from "./contract";
import { INITIAL_RULES, NIGHTS, SITES, isoAt, type NightData } from "./mock-data";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const incidentStatus = new Map<number, Incident["status"]>();
const dismissed = new Set<number>();
for (const n of Object.values(NIGHTS)) for (const e of n.events) if (e.dismissed) dismissed.add(e.id);
let rules: Rule[] = INITIAL_RULES.map((r) => ({ ...r }));
let nextRuleId = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(180 + Math.random() * 260);
const clone = <T,>(v: T): T => structuredClone(v);

function siteOr404(id: string): Site {
  const s = SITES.find((x) => x.id === id);
  if (!s) throw new ApiError(404, "Site not found");
  return s;
}

function nightData(siteId: string, night: string | null): NightData {
  const s = siteOr404(siteId);
  const n = NIGHTS[`${siteId}|${night ?? s.default_night}`];
  if (!n) throw new ApiError(404, "No recordings for that night");
  return n;
}

const allEvents = () => Object.values(NIGHTS).flatMap((n) => n.events);
const findEvent = (id: number) => allEvents().find((e) => e.id === id);
const localHour = (iso: string) => Number(iso.slice(11, 13));
const localMinutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function isArmedAt(site: Site, iso: string): boolean {
  if (site.armed.all_day) return true;
  const m = localMinutes(iso);
  const from = toMin(site.armed.from);
  const to = toMin(site.armed.to);
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

const hourInRange = (h: number, from: number, to: number) => (from <= to ? h >= from && h <= to : h >= from || h <= to);
const pad = (n: number) => String(n).padStart(2, "0");

function ruleMatches(rule: Rule, e: CameraEvent): boolean {
  if (rule.site_id !== e.site_id || rule.camera_id !== e.camera_id) return false;
  if ((e.report?.activity ?? e.kind) !== rule.activity) return false;
  if (!hourInRange(localHour(e.start), rule.hour_from, rule.hour_to)) return false;
  // Rules can never hide a person seen while the site is armed.
  const site = SITES.find((s) => s.id === e.site_id)!;
  if (e.report?.person_present === "yes" && isArmedAt(site, e.start)) return false;
  return true;
}

/** Current view of an event: dismissals and rules created this session applied. */
function liveEvent(e: CameraEvent): CameraEvent {
  const out = clone(e);
  out.dismissed = dismissed.has(e.id);
  if (out.severity !== "ignore" && out.severity !== "camera_issue") {
    const rule = rules.find((r) => r.id >= 10 && ruleMatches(r, e));
    if (rule) {
      out.severity = "ignore";
      out.reasons = [...out.reasons, { label: `Matched your rule: ${rule.note}`, source: "rule" }];
    }
  }
  return out;
}

function liveIncident(inc: Incident): Incident {
  const out = clone(inc);
  const override = incidentStatus.get(inc.id);
  if (override) out.status = override;
  else if (inc.event_ids.every((id) => dismissed.has(id))) out.status = "dismissed";
  return out;
}

const liveNight = (n: NightData) => ({
  events: n.events.map(liveEvent),
  incidents: n.incidents.map(liveIncident),
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
function previewFor(eventId: number): RulePreview {
  const e = findEvent(eventId);
  if (!e) throw new ApiError(404, "Event not found");
  const activity = e.report?.activity ?? e.kind;
  const label = (e.report?.activity_label ?? e.title).toLowerCase();
  const site = SITES.find((s) => s.id === e.site_id)!;
  const same = allEvents().filter((x) => x.site_id === e.site_id && x.camera_id === e.camera_id && (x.report?.activity ?? x.kind) === activity);
  // Cover the hours this kind of event has happened at (night order: afternoon first).
  const nightHour = (h: number) => (h < 12 ? h + 24 : h);
  const hours = same.map((x) => nightHour(localHour(x.start)));
  const from = Math.min(...hours) % 24;
  const to = Math.max(...hours) % 24;
  const rule: Omit<Rule, "id" | "created_at"> = {
    site_id: e.site_id,
    camera_id: e.camera_id,
    activity,
    hour_from: from,
    hour_to: to,
    note: `Hide '${label}' on ${e.camera_name} between ${pad(from)}:00 and ${pad(to)}:59 every night`,
  };
  const probe = { ...rule, id: -1, created_at: "" } as Rule;
  const wouldHide = same.filter((x) => ruleMatches(probe, x)).length;
  const personArmed = e.report?.person_present === "yes" && isArmedAt(site, e.start);
  return {
    event_id: e.id,
    rule,
    description: rule.note,
    would_hide: wouldHide,
    caveat: personArmed
      ? "This event shows a person while the site was armed. Rules never hide that, so events like this one will keep showing."
      : "A person seen while the site is armed still shows, even with this rule.",
  };
}

// ---------------------------------------------------------------------------
// Brief and portfolio
// ---------------------------------------------------------------------------
const sevOrder: Incident["severity"][] = ["needs_look", "unconfirmed", "camera_issue", "fyi", "guard", "ignore"];

function ignoredReason(e: CameraEvent): string {
  if (e.dismissed) return "Dismissed by you";
  const labels = e.reasons.map((r) => r.label);
  if (labels.some((l) => l.startsWith("Matched your rule"))) return "Matched a site rule";
  if (labels.some((l) => l.startsWith("Site disarmed"))) return "Work hours (disarmed)";
  if (labels.includes("Animal")) return "Animal";
  if (labels.includes("Weather")) return "Weather";
  if (labels.some((l) => l.startsWith("Lighting"))) return "Lighting change";
  return labels[0] ?? "Nothing of interest";
}

function buildBrief(n: NightData): Brief {
  const { events, incidents } = liveNight(n);
  const sortedIncidents = [...incidents].sort(
    (a, b) =>
      Number(a.status !== "open") - Number(b.status !== "open") ||
      sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity) ||
      a.start.localeCompare(b.start),
  );
  const ignored = events.filter((e) => e.severity === "ignore" || e.dismissed);
  const reasons: Record<string, number> = {};
  for (const e of ignored) reasons[ignoredReason(e)] = (reasons[ignoredReason(e)] ?? 0) + 1;

  const health = n.health.filter((h) => h.status !== "ok").map((h) => ({ camera_id: h.camera_id, camera_name: h.camera_name, status: h.status, note: h.note }));
  const open = incidents.filter((i) => i.status === "open");
  const fyi = events.filter((e) => e.severity === "fyi" && !e.dismissed);
  const missingAssets = n.assets.filter((a) => a.status === "missing");
  const status: Brief["status"] =
    open.length || missingAssets.length ? "needs_look" : health.length ? "camera_issue" : fyi.length ? "fyi" : "all_good";

  const repeat_vehicles = n.repeatVehicles.map((rv) => ({
    description: rv.description,
    text: rv.text,
    nights: [...new Set(rv.sightings.map((s) => s.night))],
    sightings: rv.sightings.map((s) => {
      const src = NIGHTS[`${n.site_id}|${s.night}`];
      const e = src.events.find((x) => x.id === src.keyToId[s.key])!;
      return { event_id: e.id, at: e.start, camera_name: e.camera_name, image: e.media.key_frame };
    }),
  }));

  const suggestions: RuleSuggestion[] = n.suggestions
    .filter((s) => !rules.some((r) => r.site_id === n.site_id && r.camera_id === s.cam && r.activity === s.activity))
    .map((s) => {
      const e = n.events.find((x) => x.id === s.eventId)!;
      return {
        camera_id: s.cam,
        camera_name: e.camera_name,
        activity_label: e.report?.activity_label ?? e.title,
        dismissed_count: s.dismissed,
        preview: previewFor(s.eventId),
      };
    });

  return {
    site_id: n.site_id,
    night: n.night,
    status,
    headline: status === "all_good" && n.headline_by === "ai" ? "Quiet night. Nothing needed a look." : n.headline,
    headline_by: n.headline_by,
    incidents: sortedIncidents,
    fyi,
    ignored: { count: ignored.length, reasons },
    lockup: clone(n.lockup),
    patrol: n.patrols
      ? { coverage_pct: n.patrols.coverage_pct, missed: n.patrols.insights.filter((i) => i.severity !== "guard") }
      : null,
    health,
    est_cost_usd: n.est_cost_usd,
    deliveries: events.filter((e) => n.deliveryIds.includes(e.id)),
    assets: clone(n.assets),
    repeat_vehicles,
    suggestions,
  };
}

function portfolioRow(s: Site, night: string | null): PortfolioSite {
  const n = nightData(s.id, s.nights.includes(night ?? "") ? night : s.default_night);
  const brief = buildBrief(n);
  const open = brief.incidents.filter((i) => i.status === "open");
  const openNeeds = open.filter((i) => i.severity === "needs_look").length;
  const unconfirmed = open.filter((i) => i.severity === "unconfirmed").length;
  const missedRounds = n.patrols
    ? n.patrols.rounds.reduce((acc, r) => acc + Object.values(r.visits).filter((v) => v.status === "missed").length, 0)
    : 0;
  const missingAssets = brief.assets.filter((a) => a.status === "missing");
  const lockupOk = brief.lockup.length ? brief.lockup.every((l) => l.ok) : null;

  const parts: string[] = [];
  if (openNeeds) parts.push(`${openNeeds} ${openNeeds === 1 ? "incident needs" : "incidents need"} a look`);
  if (missingAssets.length) parts.push(`${missingAssets.map((a) => a.asset).join(", ")} missing`);
  if (unconfirmed) parts.push(`${unconfirmed} unconfirmed`);
  if (missedRounds) parts.push(`${missedRounds} missed checkpoint${missedRounds === 1 ? "" : "s"}`);
  for (const h of brief.health) parts.push(`${h.camera_name} camera ${h.status}`);
  if (!parts.length && brief.fyi.length) parts.push(`FYI: ${brief.fyi[0].title.toLowerCase()}`);
  if (!parts.length) parts.push(lockupOk === false ? "Lock-up check failed" : "Quiet night, lock-up all OK");

  return {
    site: clone(s),
    night: n.night,
    status: brief.status,
    headline: brief.headline,
    open_incidents: openNeeds,
    unconfirmed,
    missed_rounds: missedRounds,
    camera_issues: brief.health.length,
    lockup_ok: lockupOk,
    assets_missing: missingAssets.length,
    key_frame: open[0]?.key_frame ?? brief.fyi[0]?.media.key_frame ?? n.cameras[0]?.poster ?? null,
    rank_reason: parts.join(" · "),
  };
}

function urgency(p: PortfolioSite): number {
  return (
    p.open_incidents * 1000 +
    p.assets_missing * 500 +
    p.unconfirmed * 400 +
    p.camera_issues * 200 +
    p.missed_rounds * 50 +
    (p.lockup_ok === false ? 300 : 0) +
    (p.status === "fyi" ? 20 : 0)
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const SUBJECTS: Record<string, string[]> = {
  person: ["person", "people", "anyone", "anybody", "someone", "somebody", "guard", "intruder", "man", "woman", "worker", "crew"],
  vehicle: ["vehicle", "vehicles", "car", "cars", "ute", "utes", "truck", "trucks", "van", "delivery", "deliveries"],
  animal: ["animal", "animals", "fox", "dog", "cat"],
};
const STOP = new Set(
  "the a an and or of on in at to was were is are did does do when what who show me any after before near by from there here site last night tonight this that with for it its arrive arrived arriving find all see seen".split(" "),
);

const t12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
};

function parseClock(h: string, m: string | undefined, ap: string): string {
  let hour = Number(h) % 12;
  if (ap === "pm") hour += 12;
  return `${pad(hour)}:${m ?? "00"}`;
}

function interpret(site: Site, cams: { id: string; name: string }[], q: string) {
  const text = q.toLowerCase();
  const words: string[] = text.match(/[a-z0-9']+/g) ?? [];
  const subjects = Object.entries(SUBJECTS)
    .filter(([, ws]) => ws.some((w) => words.includes(w)))
    .map(([k]) => k);
  const cameras = cams.filter((c) => {
    const nameWords = c.name.toLowerCase().split(/\s+/).filter((w) => !["road", "yard", "base", "frontage"].includes(w) || c.name.split(" ").length === 1);
    return nameWords.some((w) => words.includes(w)) || text.includes(c.name.toLowerCase());
  });
  let start: string | null = null;
  let end: string | null = null;
  const after = text.match(/after (\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (after) start = parseClock(after[1], after[2], after[3]);
  if (/after midnight/.test(text)) start = "00:00";
  const before = text.match(/before (\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (before) end = parseClock(before[1], before[2], before[3]);
  const camWords = new Set(cameras.flatMap((c) => c.name.toLowerCase().split(/\s+/)));
  const subjectWords = new Set(Object.values(SUBJECTS).flat());
  const keywords = [...new Set(words.filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w) && !["am", "pm", "midnight"].includes(w) && !camWords.has(w) && (!subjectWords.has(w) || ["delivery", "truck", "ute", "guard", "fox"].includes(w))))];
  return { subjects, cameras, start, end, keywords, siteName: site.name.split(/[ ,]/)[0] };
}

function subjectMatch(e: CameraEvent, s: string): boolean {
  const r = e.report;
  if (!r) return false;
  if (s === "person") return r.person_present === "yes" || r.person_present === "cant_tell";
  if (s === "vehicle") return r.vehicle_present === "yes";
  if (s === "animal") return r.activity === "animal";
  return false;
}

function doSearch(siteId: string, night: string | null, q: string): SearchResponse {
  const site = siteOr404(siteId);
  const nights = night ? [night] : site.nights;
  const datas = nights.map((n) => NIGHTS[`${siteId}|${n}`]).filter(Boolean);
  const cams = datas[0]?.cameras ?? [];
  const it = interpret(site, cams, q);
  const refNight = night ?? site.default_night;
  const startIso = it.start ? isoAt(refNight, it.start) : null;
  const endIso = it.end ? isoAt(refNight, it.end) : null;

  const scored: { e: CameraEvent; score: number; hits: string[]; why: string[] }[] = [];
  for (const d of datas) {
    for (const raw of d.events) {
      const e = liveEvent(raw);
      if (e.kind === "blank_view") continue;
      const n = d.night;
      const t = Date.parse(e.start);
      if (it.start && t < Date.parse(isoAt(n, it.start))) continue;
      if (it.end && t > Date.parse(isoAt(n, it.end))) continue;
      if (it.cameras.length && !it.cameras.some((c) => c.id === e.camera_id)) continue;
      if (it.subjects.length && !it.subjects.some((s) => subjectMatch(e, s))) continue;
      const hay = `${e.title} ${e.report?.search_text ?? ""} ${e.report?.summary ?? ""}`.toLowerCase();
      const hits = it.keywords.filter((k) => hay.includes(k.replace(/s$/, "")));
      if (!it.subjects.length && !it.cameras.length && !it.start && it.keywords.length && !hits.length) continue;
      if (!it.subjects.length && !it.cameras.length && !it.start && !it.keywords.length) continue;
      const why: string[] = [];
      for (const s of it.subjects) if (subjectMatch(e, s)) why.push(s === "person" ? "a person" : s === "vehicle" ? "a vehicle" : "an animal");
      if (it.cameras.length) why.push(e.camera_name);
      if (it.start) why.push(`after ${it.start === "00:00" ? "midnight" : t12(it.start)}`);
      for (const h of hits) why.push(`“${h}”`);
      const severityBoost = e.severity === "needs_look" ? 1.5 : e.severity === "unconfirmed" ? 1 : 0;
      scored.push({ e, score: hits.length * 3 + why.length + severityBoost, hits, why });
    }
  }
  const whenQuestion = /^when\b/.test(q.trim().toLowerCase());
  scored.sort((a, b) => (whenQuestion ? b.hits.length - a.hits.length : b.score - a.score) || a.e.start.localeCompare(b.e.start));
  const top = scored.slice(0, 12);

  const results: SearchResult[] = top.map((s, i) => {
    const words = [...s.hits];
    for (const sub of it.subjects) {
      const hay = `${s.e.title} ${s.e.report?.summary ?? ""}`.toLowerCase();
      const w = SUBJECTS[sub].find((x) => hay.includes(x));
      if (w) words.push(w);
    }
    const checked = i < 3 && !!s.e.report;
    return {
      event: s.e,
      why: `Matches: ${s.why.join(", ") || "your question"}`,
      highlights: [...new Set(words)],
      checked_on_frames: checked,
      frame_check: checked ? (s.e.report!.confidence === "low" ? "not_confirmed" : "confirmed") : null,
    };
  });

  const tz = site.timezone;
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
      .format(new Date(iso))
      .replace(/\s/g, "")
      .toLowerCase();
  const describe = (e: CameraEvent) => `${e.title.charAt(0).toLowerCase()}${e.title.slice(1)} (${e.camera_name}, ${t(e.start)}) [#${e.id}]`;

  let answer: string | null = null;
  if (results.length) {
    const evs = results.map((r) => r.event);
    const guards = evs.filter((e) => e.severity === "guard");
    const others = evs.filter((e) => e.severity !== "guard");
    if (whenQuestion) {
      const [a, b] = [...evs.slice(0, 2)].sort((x, y) => x.start.localeCompare(y.start));
      const say = (e: CameraEvent) => `${e.title.charAt(0).toLowerCase()}${e.title.slice(1)} at ${t(e.start)} on ${e.camera_name} [#${e.id}]`;
      answer = `${say(a).replace(/^./, (c) => c.toUpperCase())}.`;
      if (b) answer += ` Later, ${say(b)}.`;
    } else {
      const lead = /^(was|were|is|did|has|have)\b/.test(q.trim().toLowerCase()) ? "Yes. " : "";
      const list = others.slice(0, 3).map(describe);
      const guardPart = guards.length ? `the guard's patrol visits ${guards.slice(0, 3).map((g) => `[#${g.id}]`).join("")}` : "";
      if (list.length && guardPart) answer = `${lead}Apart from ${guardPart}: ${list.join("; ")}.`;
      else if (list.length) answer = `${lead}${list.length === 1 ? "One" : `${others.length}`} recorded moment${list.length === 1 ? "" : "s"}: ${list.join("; ")}.`;
      else answer = `${lead}Only ${guardPart}.`;
      answer = answer.charAt(0).toUpperCase() + answer.slice(1);
    }
  }

  const subjLabel = it.subjects.length
    ? it.subjects.map((s) => (s === "person" ? "People" : s === "vehicle" ? "Vehicles" : "Animals")).join(" and ")
    : it.keywords.length
      ? it.keywords.slice(0, 3).join(" ").replace(/^./, (c) => c.toUpperCase())
      : "Anything";
  const where = it.cameras.length ? ` on ${it.cameras.map((c) => c.name).join(", ")}` : "";
  const when = it.start ? `, ${it.start === "00:00" ? "midnight" : t(isoAt(refNight, it.start))} onwards` : night ? ", last night" : ", all stored nights";

  return {
    query: q,
    interpreted: {
      cameras: it.cameras.map((c) => c.name),
      start: startIso,
      end: endIso,
      subjects: it.subjects,
      keywords: it.keywords,
      summary: `${subjLabel}${where}${when}, ${it.siteName}`,
    },
    answer,
    results,
    note: "This system doesn't identify people. It only finds moments the motion detector caught and the AI described.",
    est_cost_usd: 0.004,
  };
}

// ---------------------------------------------------------------------------
// The mock API
// ---------------------------------------------------------------------------
export const mockApi: Api = {
  async getSites() {
    await latency();
    return clone(SITES);
  },
  async getPortfolio(night) {
    await latency();
    return SITES.map((s) => portfolioRow(s, night)).sort((a, b) => urgency(b) - urgency(a));
  },
  async getWall(siteId, night): Promise<Wall> {
    await latency();
    const n = nightData(siteId, night);
    const live = liveNight(n);
    return { site_id: siteId, night: n.night, window: clone(n.window), cameras: clone(n.cameras), events: live.events, incidents: live.incidents };
  },
  async getBrief(siteId, night) {
    await latency();
    return buildBrief(nightData(siteId, night));
  },
  async getIncidents(siteId, night, status) {
    await latency();
    const live = liveNight(nightData(siteId, night));
    return live.incidents.filter((i) => !status || i.status === status);
  },
  async getIncident(id): Promise<IncidentDetail> {
    await latency();
    for (const n of Object.values(NIGHTS)) {
      const inc = n.incidents.find((i) => i.id === id);
      if (inc) {
        const live = liveNight(n);
        return { ...liveIncident(inc), events: live.events.filter((e) => inc.event_ids.includes(e.id)) };
      }
    }
    throw new ApiError(404, "Incident not found");
  },
  async setIncidentStatus(id, status) {
    await latency();
    for (const n of Object.values(NIGHTS)) {
      const inc = n.incidents.find((i) => i.id === id);
      if (inc) {
        incidentStatus.set(id, status);
        return liveIncident(inc);
      }
    }
    throw new ApiError(404, "Incident not found");
  },
  async dismissEvent(id) {
    await latency();
    const e = findEvent(id);
    if (!e) throw new ApiError(404, "Event not found");
    dismissed.add(id);
    // A fresh dismissal clears any earlier "open"/"handled" override so the incident follows its events.
    if (e.incident_id != null) incidentStatus.delete(e.incident_id);
    return liveEvent(e);
  },
  async getRulePreview(eventId) {
    await sleep(350);
    return previewFor(eventId);
  },
  async createRule(eventId) {
    await latency();
    const p = previewFor(eventId);
    const rule: Rule = { ...p.rule, id: nextRuleId++, created_at: new Date().toISOString() };
    rules = [...rules, rule];
    return clone(rule);
  },
  async getRules(siteId) {
    await latency();
    siteOr404(siteId);
    return clone(rules.filter((r) => r.site_id === siteId));
  },
  async deleteRule(id) {
    await latency();
    rules = rules.filter((r) => r.id !== id);
    return { ok: true };
  },
  async search({ site_id, night, q }) {
    await sleep(2300 + Math.random() * 500);
    return doSearch(site_id, night, q);
  },
  async getPatrols(siteId, night) {
    await latency();
    const n = nightData(siteId, night);
    if (!n.patrols) throw new ApiError(404, "This site has no guard patrols");
    return clone(n.patrols);
  },
  async getHealth(siteId, night) {
    await latency();
    return clone(nightData(siteId, night).health);
  },
};
