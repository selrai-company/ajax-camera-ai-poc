/** Time formatting. All clock times are shown in the site's own timezone. */
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", opts);
    cache.set(key, f);
  }
  return f;
}

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** "2:14am" or "2:14:05am". */
export function clock(v: string | number | Date, tz: string, seconds = false): string {
  const parts = fmt(`clock|${tz}|${seconds}`, {
    hour: "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: true,
    timeZone: tz,
  }).formatToParts(toDate(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}${seconds ? `:${get("second")}` : ""}${get("dayPeriod").toLowerCase().replace(/\./g, "")}`;
}

/** "2:14–2:19am" (drops the first am/pm when both match). */
export function clockRange(a: string, b: string, tz: string): string {
  const x = clock(a, tz);
  const y = clock(b, tz);
  if (x === y) return x;
  const px = x.slice(-2);
  return px === y.slice(-2) ? `${x.slice(0, -2)}–${y}` : `${x}–${y}`;
}

/** "Tue 10 Nov" for a night key like "2026-11-10". */
export function nightDay(night: string): string {
  return fmt("day", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${night}T12:00:00Z`));
}

/** "Tue 10 Nov night" style label used in selectors. */
export function nightLabel(night: string): string {
  return `${nightDay(night)} night`;
}

/** "18:00" → "6:00pm". */
export function hhmm(v: string): string {
  const [h, m] = v.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")}${ap}`;
}

/** 22 → "10pm", 0 → "midnight". */
export function hourLabel(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "midday";
  return `${h % 12}${h >= 12 ? "pm" : "am"}`;
}

/** Seconds → "0:04". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Hours and minutes between two instants, e.g. "4 h 12 min". */
export function span(aMs: number, bMs: number): string {
  const min = Math.round(Math.abs(bMs - aMs) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Same local time-of-night shifted onto another night (for replay start on other nights). */
export function shiftToNight(iso: string, fromNight: string, toNight: string): number {
  const days = (Date.parse(`${toNight}T00:00:00Z`) - Date.parse(`${fromNight}T00:00:00Z`)) / 86400000;
  return Date.parse(iso) + days * 86400000;
}

export const ms = (iso: string) => Date.parse(iso);
