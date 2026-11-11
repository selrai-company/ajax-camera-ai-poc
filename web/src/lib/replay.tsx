import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWall } from "../api/hooks";
import { useSite } from "./site";
import { shiftToNight } from "./time";

export type Speed = 1 | 4 | 16;

interface ReplayCtx {
  /** Current wall-clock time being shown (ms since epoch). */
  t: number;
  playing: boolean;
  speed: Speed;
  /** True for live sites (no replay controls). */
  live: boolean;
  ready: boolean;
  window: { start: number; end: number } | null;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: Speed) => void;
  seek: (ms: number) => void;
  restart: () => void;
}

const Ctx = createContext<ReplayCtx | null>(null);

/**
 * The replay clock. Demo sites play recorded clips against this clock, starting at
 * site.replay_start; tiles show whichever recording covers the current time.
 */
export function ReplayProvider({ children }: { children: ReactNode }) {
  const { site, night } = useSite();
  const wall = useWall(site?.id, night);
  const w = wall.data && wall.data.site_id === site?.id && wall.data.night === night ? wall.data.window : null;
  const win = useMemo(() => (w ? { start: Date.parse(w.start), end: Date.parse(w.end) } : null), [w]);
  const live = !!site && !site.demo;

  const startMs = useMemo(() => {
    if (!site || !night || !win) return 0;
    const s = shiftToNight(site.replay_start, site.default_night, night);
    return Math.min(Math.max(s, win.start), win.end);
  }, [site, night, win]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const key = `${site?.id}|${night}|${win ? "ready" : "wait"}`;

  useEffect(() => {
    if (!win) return;
    setT(live ? Date.now() : startMs);
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const endRef = useRef(0);
  endRef.current = win?.end ?? 0;

  useEffect(() => {
    if (!win) return;
    if (live) {
      const id = setInterval(() => setT(Date.now()), 1000);
      return () => clearInterval(id);
    }
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) * speed;
      last = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= endRef.current) {
          setPlaying(false);
          return endRef.current;
        }
        return next;
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing, speed, win, live]);

  const seek = useCallback(
    (v: number) => {
      if (!win || live) return;
      setT(Math.min(Math.max(v, win.start), win.end));
    },
    [win, live],
  );
  const restart = useCallback(() => {
    setT(startMs);
    setPlaying(true);
  }, [startMs]);

  const value = useMemo<ReplayCtx>(
    () => ({ t, playing, speed, live, ready: !!win, window: win, setPlaying, setSpeed, seek, restart }),
    [t, playing, speed, live, win, seek, restart],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReplay() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useReplay outside ReplayProvider");
  return c;
}
