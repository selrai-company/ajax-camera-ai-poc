import clsx from "clsx";
import { Pause, Play, RotateCcw, Siren, VideoOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CameraEvent, CameraTile } from "../api/contract";
import { useAnnotations } from "../lib/annotations";
import { useReplay, type Speed } from "../lib/replay";
import { SEVERITY, TONE } from "../lib/severity";
import { clock, ms } from "../lib/time";
import { boxAt } from "../lib/track";
import { AiMark } from "./markers";
import { CameraVideo, CoverFrame, Frame, MotionBox } from "./media";
import { Dot, Kbd } from "./ui";

export function DemoPill({ className, looping }: { className?: string; looping?: boolean }) {
  return (
    <span
      className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-2.5 text-[11px] font-medium whitespace-nowrap text-muted", className)}
      title={
        looping
          ? "Each tile loops a recorded clip from this camera, standing in for a live feed."
          : "This wall replays recorded clips against a clock. Tiles only play when a recording covers that time."
      }
    >
      <span className="size-1.5 rounded-full bg-muted" aria-hidden />
      {looping ? "Demo · looping recorded clips" : "Demo replay · recorded clips"}
    </span>
  );
}

/** Replay clock controls: time, play/pause, 1x/4x/16x, restart. */
export function ReplayControls({ tz, demo, className }: { tz: string; demo: boolean; className?: string }) {
  const { t, playing, speed, setPlaying, setSpeed, restart, live, ready } = useReplay();
  if (!ready) return <div className={clsx("skeleton h-9 w-72", className)} />;
  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      {demo && <DemoPill />}
      <span className="tnum min-w-[96px] text-[17px] font-semibold tracking-tight text-fg" aria-live="off">
        {clock(t, tz, true)}
      </span>
      {live ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Dot tone="ok" pulse /> Live
        </span>
      ) : (
        <>
          <button
            onClick={() => setPlaying(!playing)}
            className="flex size-8 items-center justify-center rounded-lg bg-raised text-fg ring-1 ring-line-strong hover:bg-overlay"
            aria-label={playing ? "Pause replay" : "Play replay"}
          >
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
          <div role="radiogroup" aria-label="Replay speed" className="flex h-8 items-center rounded-lg bg-raised p-0.5 ring-1 ring-line-strong">
            {([1, 4, 16] as Speed[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={speed === s}
                onClick={() => setSpeed(s)}
                className={clsx("tnum h-7 rounded-md px-2.5 text-xs font-medium", speed === s ? "bg-fg text-canvas" : "text-muted hover:text-fg")}
              >
                {s}x
              </button>
            ))}
          </div>
          <button onClick={restart} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg" aria-label="Restart replay" title="Restart replay">
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

/** What a camera shows at replay time t: the covering recording, the active and latest events. */
export function useCameraAt(camera: CameraTile, events: CameraEvent[], t: number) {
  const seg = camera.segments.find((s) => t >= ms(s.start) && t < ms(s.end)) ?? null;
  const camEvents = events.filter((e) => e.camera_id === camera.id);
  const active = activeAt(camEvents, t);
  let latest: CameraEvent | null = null;
  for (const e of camEvents) if (ms(e.start) <= t) latest = e;
  const blank = active?.kind === "blank_view" || (camera.health.status !== "ok" && latest?.kind === "blank_view" && t >= ms(latest.start));
  return { seg, active, latest, blank, videoTime: seg ? (t - ms(seg.start)) / 1000 : 0 };
}

/** The most important event overlapping time t (prefers ones with a motion track). */
function activeAt(camEvents: CameraEvent[], t: number): CameraEvent | null {
  const hits = camEvents.filter((e) => t >= ms(e.start) && t <= ms(e.end));
  if (!hits.length) return null;
  return hits.sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || (b.track?.length ?? 0) - (a.track?.length ?? 0))[0];
}

type Alert = { incidentId: number; severity: "needs_look" | "unconfirmed" } | null;

export function ReplayView({
  camera,
  events,
  big,
  className,
  children,
}: {
  camera: CameraTile;
  events: CameraEvent[];
  big?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const { t, playing, speed } = useReplay();
  const [annotations] = useAnnotations();
  const { seg, active, blank, videoTime } = useCameraAt(camera, events, t);
  const [failed, setFailed] = useState<string | null>(null);
  const box = annotations && active ? boxAt(active.track, (t - ms(active.start)) / 1000) : null;
  const showVideo = seg && failed !== seg.src && !blank;

  return (
    <div data-media-bounds className={clsx("relative overflow-hidden bg-black", className)} style={{ containerType: "size" }}>
      {showVideo ? (
        <CameraVideo key={seg.src} src={seg.src} time={videoTime} playing={playing} rate={speed} onFail={() => setFailed(seg.src)} />
      ) : (
        <Frame src={blank ? null : camera.poster} alt="" dim rounded={false} className="absolute inset-0" fallbackText={blank ? "" : "No poster frame"} />
      )}
      {!showVideo && <CenterNote big={big}>{blank ? <><VideoOff className="size-3.5 text-sev-amber" aria-hidden /> View blank</> : seg && failed === seg.src ? "Recording unavailable" : "No motion"}</CenterNote>}
      {box && active && (
        <CoverFrame>
          <MotionBox box={box} severity={active.severity} label={active.title} smooth compact={!big} />
        </CoverFrame>
      )}
      {children}
    </div>
  );
}

function CenterNote({ children, big }: { children: ReactNode; big?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className={clsx("flex items-center gap-1.5 rounded-full bg-black/60 font-medium text-muted backdrop-blur-sm", big ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]")}>
        {children}
      </span>
    </div>
  );
}

/**
 * Shared tile chrome: camera name across the top (never squeezed), a compact status on the right,
 * the severity badge bottom-left above the caption, and the ring.
 */
function TileChrome({
  camera,
  index,
  alert,
  status,
  caption,
  captionActive,
  ring,
  tz,
  children,
}: {
  camera: CameraTile;
  index: number;
  alert: Alert;
  status: ReactNode;
  caption: CameraEvent | null;
  captionActive: boolean;
  ring: "red" | "amber" | null;
  tz: string;
  children: ReactNode;
}) {
  const red = alert?.severity === "needs_look";
  return (
    <div
      className={clsx(
        "group @container relative h-full w-full overflow-hidden rounded-xl bg-black ring-1 transition-shadow",
        ring === "red" ? "ring-2 ring-sev-red animate-pulse-ring" : ring === "amber" ? "ring-2 ring-sev-amber" : "ring-line hover:ring-line-strong",
      )}
    >
      <Link to={`/cameras/${camera.id}`} aria-label={`${camera.name}. Open camera${index <= 9 ? ` (shortcut ${index})` : ""}`} className="block h-full">
        {children}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 bg-gradient-to-b from-black/75 to-transparent p-2 pb-6">
          {index <= 9 && <Kbd>{index}</Kbd>}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white drop-shadow" title={camera.name}>
            {camera.name}
          </span>
          {alert && (
            <span
              className={clsx("flex size-5 shrink-0 items-center justify-center rounded-full", red ? "bg-sev-red text-white" : "bg-sev-amber text-[#1a1205]")}
              title={SEVERITY[alert.severity].label}
            >
              <Siren className="size-3" aria-hidden />
              <span className="sr-only">{SEVERITY[alert.severity].label}</span>
            </span>
          )}
          {status}
        </div>
        {caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-2 pt-7">
            <p className={clsx("flex items-center gap-1.5 text-[12px] leading-tight", captionActive ? "text-white" : "text-white/75")}>
              <Dot tone={SEVERITY[caption.severity].tone} className="size-1.5" />
              <span className="min-w-0 truncate">{caption.title}</span>
              {caption.report && <AiMark compact className="text-ai" />}
              <span className="tnum ml-auto shrink-0 text-[11px] text-white/60">{clock(caption.start, tz)}</span>
            </p>
          </div>
        )}
      </Link>
      {alert && (
        <Link
          to={`/incidents/${alert.incidentId}`}
          className={clsx(
            "absolute left-2 z-30 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold shadow-lg @max-[280px]:hidden",
            caption ? "bottom-8" : "bottom-2",
            red ? "bg-sev-red text-white" : "bg-sev-amber text-[#1a1205]",
          )}
        >
          <Siren className="size-3" aria-hidden />
          {red ? "Needs a look" : "Unconfirmed"}
        </Link>
      )}
    </div>
  );
}

function StatusChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/85">
      <span className={clsx("size-1.5 rounded-full", on ? "bg-ok" : "bg-white/40")} aria-hidden />
      <span className="@max-[280px]:sr-only">{label}</span>
    </span>
  );
}

function HealthChip({ status }: { status: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-sev-amber/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#1a1205]">
      {status === "blank" ? "Blank" : status === "moved" ? "Moved" : "Offline"}
    </span>
  );
}

const ringFor = (e: CameraEvent | null): "red" | "amber" | null =>
  e?.severity === "needs_look" ? "red" : e?.severity === "unconfirmed" ? "amber" : null;

/** Replay mode tile: follows the shared replay clock. */
export function WallTile({ camera, events, index, alert, tz }: { camera: CameraTile; events: CameraEvent[]; index: number; alert: Alert; tz: string }) {
  const { t } = useReplay();
  const { seg, latest, active, blank } = useCameraAt(camera, events, t);
  const health = camera.health.status !== "ok" ? camera.health.status : blank ? "blank" : null;
  return (
    <TileChrome
      camera={camera}
      index={index}
      alert={alert}
      status={health ? <HealthChip status={health} /> : <StatusChip on={!!seg} label={seg ? "Recording" : "Idle"} />}
      caption={active ?? latest}
      captionActive={!!active}
      ring={alert ? (alert.severity === "needs_look" ? "red" : "amber") : null}
      tz={tz}
    >
      <ReplayView camera={camera} events={events} className="h-full w-full" />
    </TileChrome>
  );
}

/** The recording a live-view tile loops: the one holding the camera's most serious event, else the latest. */
export function pickLiveSegment(camera: CameraTile, events: CameraEvent[]) {
  if (!camera.segments.length) return null;
  const ranked = events
    .filter((e) => e.camera_id === camera.id)
    .sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || (b.track?.length ?? 0) - (a.track?.length ?? 0));
  for (const e of ranked) {
    const seg = camera.segments.find((s) => ms(e.start) >= ms(s.start) && ms(e.start) < ms(s.end));
    if (seg) return seg;
  }
  return camera.segments[camera.segments.length - 1];
}

/**
 * Live view tile: loops its camera's recording like a feed. The tile's own clock is
 * segment.start + currentTime, so boxes, caption and ring appear exactly when the loop reaches an event.
 */
export function LiveTile({ camera, events, index, alert, tz }: { camera: CameraTile; events: CameraEvent[]; index: number; alert: Alert; tz: string }) {
  const seg = pickLiveSegment(camera, events);
  const ref = useRef<HTMLVideoElement>(null);
  const [local, setLocal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [annotations] = useAnnotations();
  const camEvents = events.filter((e) => e.camera_id === camera.id);

  useEffect(() => {
    if (!seg) return;
    const start = ms(seg.start);
    const id = setInterval(() => {
      const v = ref.current;
      if (v && v.readyState >= 2) setLocal(start + v.currentTime * 1000);
    }, 100);
    return () => clearInterval(id);
  }, [seg]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.play().then(
      () => setBlocked(false),
      (err: DOMException) => err?.name === "NotAllowedError" && setBlocked(true),
    );
  }, [seg?.src]);

  const active = local != null ? activeAt(camEvents, local) : null;
  const inSeg = seg ? camEvents.filter((e) => ms(e.start) >= ms(seg.start) && ms(e.start) < ms(seg.end)) : [];
  const caption = active ?? inSeg[0] ?? camEvents[camEvents.length - 1] ?? null;
  const box = annotations && active && local != null ? boxAt(active.track, (local - ms(active.start)) / 1000) : null;
  const health = camera.health.status !== "ok" ? camera.health.status : null;
  const tone = active ? TONE[SEVERITY[active.severity].tone] : null;

  return (
    <TileChrome
      camera={camera}
      index={index}
      alert={alert}
      status={health ? <HealthChip status={health} /> : <StatusChip on={!!seg && !failed} label={seg && !failed ? "Live" : "No feed"} />}
      caption={caption}
      captionActive={!!active}
      ring={ringFor(active)}
      tz={tz}
    >
      <div data-media-bounds className="relative h-full w-full overflow-hidden bg-black" style={{ containerType: "size" }}>
        {seg && !failed ? (
          <video
            ref={ref}
            key={seg.src}
            src={seg.src}
            poster={camera.poster ?? undefined}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            disablePictureInPicture
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <>
            <Frame src={camera.poster} alt="" dim rounded={false} className="absolute inset-0" />
            <CenterNote>{failed ? "Recording unavailable" : "No recordings tonight"}</CenterNote>
          </>
        )}
        {box && active && (
          <CoverFrame>
            <MotionBox box={box} severity={active.severity} label={active.title} compact smooth />
          </CoverFrame>
        )}
        {local != null && seg && (
          <span className={clsx("tnum pointer-events-none absolute right-2 bottom-8 z-20 rounded bg-black/55 px-1 text-[10px] @max-[280px]:hidden", tone ? tone.text : "text-white/60")}>
            {clock(local, tz, true)}
          </span>
        )}
        {blocked && (
          <button
            onClick={(e) => {
              e.preventDefault();
              void ref.current?.play().then(() => setBlocked(false));
            }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
            aria-label={`Play ${camera.name}`}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-fg text-canvas">
              <Play className="size-4" aria-hidden />
            </span>
          </button>
        )}
      </div>
    </TileChrome>
  );
}
