import clsx from "clsx";
import { Eye, EyeOff, ImageOff, Pause, Play, VideoOff } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CameraEvent, Severity } from "../api/contract";
import { useAnnotations } from "../lib/annotations";
import { toneOf } from "../lib/severity";
import { mmss } from "../lib/time";
import { boxAt, boxForFrame, type Box } from "../lib/track";

// ---------------------------------------------------------------------------
// Motion box: drawn only when the backend gives a track. Labelled "Movement",
// never "person": it comes from the motion detector, the words come from the AI.
// ---------------------------------------------------------------------------
export function MotionBox({
  box,
  label,
  severity,
  smooth,
  compact,
}: {
  box: Box;
  label?: string;
  severity: Severity;
  smooth?: boolean;
  compact?: boolean;
}) {
  const [x, y, w, h] = box;
  const stroke = toneOf(severity).stroke;
  const labelRef = useRef<HTMLDivElement>(null);
  // Where the label goes: below the box if there's room, else above, else inside along its bottom.
  const place = compact ? (y + h < 0.82 ? "below" : y > 0.18 ? "above" : "inside") : y < 0.12 ? (y + h < 0.9 ? "below" : "inside") : "above";

  // Keep the label inside the visible tile (boxes near an edge would push it off screen).
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    el.style.transform = "";
    const bounds = (el.closest("[data-media-bounds]") as HTMLElement | null)?.getBoundingClientRect();
    if (!bounds) return;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > bounds.right - 4) dx = bounds.right - 4 - r.right;
    if (r.left + dx < bounds.left + 4) dx = bounds.left + 4 - r.left;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  });

  return (
    <div
      className={clsx("pointer-events-none absolute z-10", smooth && "transition-all duration-200 ease-linear")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
      aria-hidden
    >
      <div className="absolute inset-0 rounded-[3px] border-2" style={{ borderColor: stroke, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(0 0 0 / 0.35)" }} />
      {label && (
        <div
          ref={labelRef}
          className={clsx(
            "absolute left-[-2px] max-w-[min(260px,80cqw)] truncate rounded-[3px] font-semibold whitespace-nowrap text-[#0c1118] shadow",
            compact ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-[11px]",
            place === "below" ? "top-full mt-1" : place === "above" ? "bottom-full mb-1" : "bottom-1 ml-1",
          )}
          style={{ background: stroke }}
        >
          Movement · {label}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Still frame with graceful fallback
// ---------------------------------------------------------------------------
export function Frame({
  src,
  alt,
  className,
  imgClassName,
  dim,
  box,
  boxSeverity = "needs_look",
  boxLabel,
  children,
  fallbackText = "No image",
  rounded = true,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imgClassName?: string;
  dim?: boolean;
  box?: Box | null;
  boxSeverity?: Severity;
  boxLabel?: string;
  children?: ReactNode;
  fallbackText?: string;
  rounded?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const [annotations] = useAnnotations();
  return (
    <div className={clsx("@container overflow-hidden bg-raised", !/\babsolute\b/.test(className ?? "") && "relative", rounded && "rounded-lg", className)}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={clsx("absolute inset-0 size-full object-cover", dim && "opacity-45 saturate-50", imgClassName)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[repeating-linear-gradient(135deg,var(--c-raised)_0_10px,var(--c-surface)_10px_20px)] text-faint">
          <ImageOff className="size-5" aria-hidden />
          <span className="text-[11px]">{fallbackText}</span>
        </div>
      )}
      {box && annotations && src && !failed && <MotionBox box={box} severity={boxSeverity} label={boxLabel} compact />}
      {children}
    </div>
  );
}

/** Key frame of an event with its motion box at the key moment (when the track allows). */
export function EventFrame({ event, className, label = false, src }: { event: CameraEvent; className?: string; label?: boolean; src?: string | null }) {
  const url = src ?? event.media.key_frame ?? event.media.frames[0] ?? null;
  return (
    <Frame
      src={url}
      alt={`${event.camera_name}: ${event.title}`}
      className={className}
      box={boxForFrame(event, url)}
      boxSeverity={event.severity}
      boxLabel={label ? event.title : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Camera video synced to an external clock. Takes only a src URL, so a live
// HLS/WebRTC source can replace the recorded clip later.
// ---------------------------------------------------------------------------
export function CameraVideo({
  src,
  time,
  playing,
  rate,
  className,
  onFail,
}: {
  src: string;
  time: number;
  playing: boolean;
  rate: number;
  className?: string;
  onFail?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const timeRef = useRef(time);
  timeRef.current = time;

  const tryPlay = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    v.play().then(
      () => setBlocked(false),
      (err: DOMException) => {
        if (err?.name === "NotAllowedError") setBlocked(true);
      },
    );
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onMeta = () => {
      v.currentTime = Math.min(timeRef.current, Math.max(0, (v.duration || 1) - 0.1));
      v.playbackRate = rate;
      if (playing) tryPlay();
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const v = ref.current;
    if (!v || v.readyState < 1) return;
    const tolerance = Math.max(0.6, rate * 0.4);
    if (Math.abs(v.currentTime - time) > tolerance && time < (v.duration || Infinity)) v.currentTime = time;
  }, [time, rate]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = Math.min(rate, 16);
    if (playing) tryPlay();
    else v.pause();
  }, [playing, rate, tryPlay]);

  return (
    <>
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={onFail}
        className={clsx("absolute inset-0 size-full object-cover", className)}
      />
      {blocked && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            tryPlay();
          }}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
          aria-label="Play video"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-fg text-canvas">
            <Play className="size-5" aria-hidden />
          </span>
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Clip player for one event: annotated video, scrubber with AI moments, chips.
// ---------------------------------------------------------------------------
export function ClipPlayer({
  event,
  autoPlay = true,
  className,
  seek,
  showMoments = true,
  onEnded,
  suspended,
}: {
  event: CameraEvent;
  autoPlay?: boolean;
  className?: string;
  /** Change the nonce to seek to t seconds from outside. */
  seek?: { t: number; nonce: number } | null;
  showMoments?: boolean;
  onEnded?: () => void;
  /** Pause while true (e.g. scrolled off screen), resume when false. */
  suspended?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [annotations, setAnnotations] = useAnnotations();
  const src = event.media.clip;

  useEffect(() => {
    setFailed(false);
    setCur(0);
    setDur(0);
  }, [src]);

  // Smooth box: follow currentTime every frame while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (ref.current) setCur(ref.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seekTo = useCallback((t: number, play = true) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
    setCur(v.currentTime);
    if (play) void v.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (seek) seekTo(seek.t);
  }, [seek, seekTo]);

  useEffect(() => {
    const v = ref.current;
    if (!v || suspended === undefined) return;
    if (suspended) v.pause();
    else void v.play().catch(() => {});
  }, [suspended]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const box = annotations ? boxAt(event.track, cur) : null;
  const total = dur || (Date.parse(event.end) - Date.parse(event.start)) / 1000;
  const moments = event.moments ?? [];
  const activeMoment = [...moments].reverse().find((m) => cur >= m.t - 0.2);

  if (!src || failed) {
    return (
      <div className={className}>
        <EventFrame event={event} label className="aspect-video w-full" />
        <p className="mt-2 flex items-center gap-2 text-xs text-faint">
          <VideoOff className="size-3.5" aria-hidden />
          {src ? "This clip couldn't be loaded. Showing the key frame." : "No clip for this event. Showing the key frame."}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div data-media-bounds className="@container relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={ref}
          src={src}
          poster={event.media.key_frame ?? undefined}
          muted
          playsInline
          loop={!onEnded}
          autoPlay={autoPlay}
          preload="metadata"
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
          onTimeUpdate={(e) => !playing && setCur(e.currentTarget.currentTime)}
          onError={() => setFailed(true)}
          onClick={toggle}
          className="absolute inset-0 size-full cursor-pointer object-contain"
          aria-label={`Clip: ${event.title}`}
        />
        {box && <MotionBox box={box} severity={event.severity} label={event.title} />}
        {activeMoment && annotations && (
          <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[80%] items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[12px] text-fg backdrop-blur-sm">
            <span className="tnum text-muted">{mmss(activeMoment.t)}</span>
            <span className="truncate">{activeMoment.label}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={toggle}
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-raised text-fg hover:bg-overlay"
          aria-label={playing ? "Pause clip" : "Play clip"}
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <Scrubber
          value={cur}
          max={total}
          severity={event.severity}
          moments={moments}
          onSeek={(t) => seekTo(t, false)}
          label={`Clip position for ${event.title}`}
        />
        <span className="tnum w-[78px] shrink-0 text-right text-xs text-muted">
          {mmss(cur)} / {mmss(total)}
        </span>
        <button
          onClick={() => setAnnotations(!annotations)}
          aria-pressed={annotations}
          className={clsx(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs",
            annotations ? "bg-raised text-fg" : "text-faint hover:text-fg",
          )}
          title={annotations ? "Hide motion boxes" : "Show motion boxes"}
        >
          {annotations ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
          <span className="hidden sm:inline">Boxes</span>
        </button>
      </div>

      {showMoments && moments.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" aria-label="AI-marked moments">
          {moments.map((m) => (
            <button
              key={`${m.t}-${m.label}`}
              onClick={() => seekTo(m.t)}
              className={clsx(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                activeMoment === m ? "border-ai/50 bg-ai/12 text-fg" : "border-line bg-surface text-muted hover:text-fg",
              )}
            >
              <span className="tnum text-faint">{mmss(m.t)}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Scrubber({
  value,
  max,
  onSeek,
  moments = [],
  severity,
  label,
}: {
  value: number;
  max: number;
  onSeek: (t: number) => void;
  moments?: { t: number; label: string }[];
  severity: Severity;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const stroke = toneOf(severity).stroke;
  return (
    <div className="relative h-8 min-w-0 flex-1">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-overlay">
        <div className="h-full rounded-full bg-fg/80" style={{ width: `${pct}%` }} />
      </div>
      {moments.map((m) => (
        <span
          key={`${m.t}-${m.label}`}
          className="pointer-events-none absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
          style={{ left: `${max > 0 ? Math.min(100, (m.t / max) * 100) : 0}%`, background: stroke }}
          title={m.label}
        />
      ))}
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.05}
        value={Math.min(value, max || 1)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={mmss(value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0 focus-visible:opacity-100 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg"
      />
      <span className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow" style={{ left: `${pct}%` }} />
    </div>
  );
}

/**
 * Overlay layer matching a 16:9 video drawn with object-fit: cover inside a tile of any shape,
 * so normalised motion boxes land on the right pixels. The parent needs container-type: size.
 */
export function CoverFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: "max(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }}
      aria-hidden
    >
      {children}
    </div>
  );
}
