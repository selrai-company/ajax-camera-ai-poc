import type { CameraEvent, TrackPoint } from "../api/contract";

export type Box = [number, number, number, number];

/** Box at time t (seconds from event start), linearly interpolated. Null outside the track. */
export function boxAt(track: TrackPoint[] | undefined, t: number): Box | null {
  if (!track || track.length === 0) return null;
  const first = track[0];
  const last = track[track.length - 1];
  if (t < first.t - 0.4 || t > last.t + 0.8) return null;
  if (t <= first.t) return first.box;
  if (t >= last.t) return last.box;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.box.map((v, j) => v + (b.box[j] - v) * k) as Box;
    }
  }
  return null;
}

export const eventDuration = (e: CameraEvent) => Math.max(0.1, (Date.parse(e.end) - Date.parse(e.start)) / 1000);

/** Seconds into the clip that a frame URL was taken at (frames are evenly spaced). */
export function frameTime(e: CameraEvent, url: string | null): number | null {
  if (!url) return null;
  const i = e.media.frames.indexOf(url);
  if (i < 0) return null;
  const n = e.media.frames.length;
  return n <= 1 ? 0 : (i / (n - 1)) * eventDuration(e);
}

/** Box to draw on a still frame: the track point nearest the frame's time. */
export function boxForFrame(e: CameraEvent, url: string | null): Box | null {
  const t = frameTime(e, url);
  if (t == null || !e.track?.length) return null;
  let best = e.track[0];
  for (const p of e.track) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return Math.abs(best.t - t) <= 3 ? best.box : null;
}
