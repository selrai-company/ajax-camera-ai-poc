import clsx from "clsx";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { CameraEvent } from "../api/contract";
import { SEVERITY, toneOf } from "../lib/severity";
import { clock } from "../lib/time";

/**
 * Night timeline: hour ticks, AI-marked events coloured by severity, and the replay playhead.
 * Click or drag the track to seek; marks open their event.
 */
export function NightTimeline({
  start,
  end,
  events,
  t,
  tz,
  onSeek,
  onMark,
  className,
  compact,
}: {
  start: number;
  end: number;
  events: CameraEvent[];
  t?: number;
  tz: string;
  onSeek?: (ms: number) => void;
  onMark?: (e: CameraEvent) => void;
  className?: string;
  compact?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const spanMs = Math.max(1, end - start);
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / spanMs) * 100));

  const hours: number[] = [];
  const firstHour = Math.ceil(start / 3600000) * 3600000;
  for (let h = firstHour; h <= end; h += 3600000) hours.push(h);
  const labelEvery = compact ? 3 : 2;

  const seekFromPointer = (e: PointerEvent) => {
    if (!onSeek || !track.current) return;
    const r = track.current.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(start + k * spanMs);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!onSeek || t == null) return;
    const step = e.shiftKey ? 10 * 60000 : 60000;
    if (e.key === "ArrowRight") onSeek(t + step);
    else if (e.key === "ArrowLeft") onSeek(t - step);
    else if (e.key === "Home") onSeek(start);
    else if (e.key === "End") onSeek(end);
    else return;
    e.preventDefault();
  };

  const marks = [...events].sort((a, b) => SEVERITY[b.severity].rank - SEVERITY[a.severity].rank);

  return (
    <div className={clsx("select-none", className)}>
      <div
        ref={track}
        role={onSeek ? "slider" : undefined}
        tabIndex={onSeek ? 0 : undefined}
        aria-label="Replay time"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={t}
        aria-valuetext={t != null ? clock(t, tz, true) : undefined}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && !(e.target as HTMLElement).closest("button") && seekFromPointer(e)}
        className={clsx("relative rounded-lg bg-canvas/60 ring-1 ring-line", compact ? "h-9" : "h-12", onSeek && "cursor-pointer")}
      >
        {hours.map((h) => (
          <span key={h} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${pct(h)}%` }} aria-hidden />
        ))}
        {marks.map((e) => {
          const tone = toneOf(e.severity);
          const minor = e.severity === "ignore" || e.severity === "guard";
          const w = Math.max(((Date.parse(e.end) - Date.parse(e.start)) / spanMs) * 100, 0);
          return (
            <button
              key={e.id}
              onClick={() => onMark?.(e)}
              aria-label={`${clock(e.start, tz)} ${SEVERITY[e.severity].label}: ${e.title}`}
              title={`${clock(e.start, tz)} · ${e.title}`}
              className={clsx(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 focus-visible:scale-125",
                minor ? (compact ? "h-3 w-1.5" : "h-4 w-1.5") : compact ? "h-5 w-2" : "h-7 w-2.5",
                tone.solid,
                e.dismissed && "opacity-40",
              )}
              style={{ left: `calc(${pct(Date.parse(e.start))}% + ${w / 2}%)` }}
            />
          );
        })}
        {t != null && (
          <span className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded bg-fg shadow-[0_0_0_2px_rgb(12_17_24/0.8)]" style={{ left: `${pct(t)}%` }} aria-hidden>
            <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-fg" />
          </span>
        )}
      </div>
      <div className="relative mt-1.5 h-4" aria-hidden>
        {hours.map((h, i) =>
          i % labelEvery === 0 ? (
            <span key={h} className="tnum absolute -translate-x-1/2 text-[11px] text-faint" style={{ left: `${pct(h)}%` }}>
              {clock(h, tz).replace(":00", "")}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
