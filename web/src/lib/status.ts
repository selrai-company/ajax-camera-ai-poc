import type { Site } from "../api/contract";
import { hhmm } from "./time";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localMinutes(ms: number, tz: string): number {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
const within = (m: number, from: string, to: string) => {
  const a = toMin(from);
  const b = toMin(to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
};

export function isArmed(site: Site, ms: number): boolean {
  return site.armed.all_day || within(localMinutes(ms, site.timezone), site.armed.from, site.armed.to);
}

export function guardOnShift(site: Site, ms: number): boolean {
  return !!site.guard_shift && within(localMinutes(ms, site.timezone), site.guard_shift.from, site.guard_shift.to);
}

export function armedLabel(site: Site, ms: number): string {
  if (site.armed.all_day) return "Armed all day";
  return isArmed(site, ms) ? `Armed since ${hhmm(site.armed.from)}` : `Disarmed · arms at ${hhmm(site.armed.from)}`;
}

export const armedHours = (site: Site) => (site.armed.all_day ? "All day" : `${hhmm(site.armed.from)} to ${hhmm(site.armed.to)}`);
