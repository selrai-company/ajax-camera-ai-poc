import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, EyeOff, MapPin, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { CameraEvent } from "../api/contract";
import { useWall } from "../api/hooks";
import { EventRow } from "../components/domain";
import { AiMark, ReasonChips } from "../components/markers";
import { NightTimeline } from "../components/NightTimeline";
import { ReplayControls, ReplayView } from "../components/replay-ui";
import { Card, EmptyState, ErrorState, Kbd, SectionTitle, SeverityPill, Skeleton, TonePill } from "../components/ui";
import { useAnnotations } from "../lib/annotations";
import { useHotkeys } from "../lib/hooks";
import { useReplay } from "../lib/replay";
import { useSite } from "../lib/site";
import { clock, mmss, ms } from "../lib/time";

export default function CameraPage() {
  const { cameraId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { site, night } = useSite();
  const wall = useWall(site?.id, night);
  const replay = useReplay();
  const [annotations, setAnnotations] = useAnnotations();

  const cameras = useMemo(() => wall.data?.cameras ?? [], [wall.data]);
  const idx = cameras.findIndex((c) => c.id === cameraId);
  const camera = idx >= 0 ? cameras[idx] : undefined;
  const events = useMemo(() => (wall.data?.events ?? []).filter((e) => e.camera_id === cameraId), [wall.data, cameraId]);

  // Deep link: ?t=ISO jumps the replay clock there once the clock is ready.
  const tParam = params.get("t");
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!tParam || !replay.ready || applied.current === tParam) return;
    applied.current = tParam;
    // Wait a tick: the replay clock resets itself when it first becomes ready.
    const id = setTimeout(() => {
      replay.seek(ms(tParam) - 2000);
      replay.setPlaying(true);
    }, 60);
    return () => clearTimeout(id);
  }, [tParam, replay.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys(
    (e) => {
      if (e.key === "Escape") navigate("/wall");
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && cameras[n - 1]) navigate(`/cameras/${cameras[n - 1].id}`);
      if (e.key === "ArrowRight" && cameras.length) navigate(`/cameras/${cameras[(idx + 1) % cameras.length].id}`);
      if (e.key === "ArrowLeft" && cameras.length) navigate(`/cameras/${cameras[(idx - 1 + cameras.length) % cameras.length].id}`);
    },
    [cameras, idx],
  );

  if (wall.error) return <ErrorState error={wall.error} onRetry={() => wall.refetch()} className="flex-1" />;
  if (!site || !wall.data) {
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="aspect-video w-full max-w-5xl" />
      </div>
    );
  }
  if (!camera) {
    return (
      <EmptyState
        title="Camera not found"
        action={
          <Link to="/wall" className="text-sm underline">
            Back to the wall
          </Link>
        }
      >
        It may belong to a different site. Pick the site from the switcher and try again.
      </EmptyState>
    );
  }

  const prev = cameras[(idx - 1 + cameras.length) % cameras.length];
  const next = cameras[(idx + 1) % cameras.length];
  const win = replay.window;

  return (
    <div className="mx-auto w-full max-w-[1500px] p-3 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/wall" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg" aria-label="Back to the wall (Esc)">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight">{camera.name}</h1>
          {camera.health.status !== "ok" && <TonePill tone="amber">{camera.health.status === "blank" ? "View blank" : camera.health.status}</TonePill>}
          <span className="hidden items-center gap-1 text-xs text-faint md:flex">
            <Kbd>Esc</Kbd> wall <Kbd>←</Kbd>
            <Kbd>→</Kbd> cameras
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/cameras/${prev.id}`} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-raised hover:text-fg" aria-label={`Previous camera: ${prev.name}`}>
            <ChevronLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">{prev.name}</span>
          </Link>
          <Link to={`/cameras/${next.id}`} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-raised hover:text-fg" aria-label={`Next camera: ${next.name}`}>
            <span className="hidden sm:inline">{next.name}</span> <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <ReplayView camera={camera} events={wall.data.events} big className="aspect-video w-full rounded-xl ring-1 ring-line" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <ReplayControls tz={site.timezone} demo={site.demo} />
            <button
              onClick={() => setAnnotations(!annotations)}
              aria-pressed={annotations}
              className={clsx("flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs ring-1 ring-line-strong", annotations ? "bg-raised text-fg" : "text-faint")}
            >
              {annotations ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
              Motion boxes
            </button>
          </div>
          {win && (
            <div className="mt-4">
              <p className="mb-2 text-[13px] font-medium text-muted">Tonight on this camera · marks are AI-described events</p>
              <NightTimeline
                start={win.start}
                end={win.end}
                events={events}
                t={replay.t}
                tz={site.timezone}
                onSeek={replay.seek}
                onMark={(e) => (e.incident_id != null ? navigate(`/incidents/${e.incident_id}`) : replay.seek(ms(e.start) - 1000))}
              />
            </div>
          )}
          <NowShowing events={events} tz={site.timezone} />
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle>About this camera</SectionTitle>
            <dl className="space-y-2.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">Zones</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {camera.zones.map((z) => (
                    <span key={z.name} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-xs">
                      {z.restricted && <ShieldAlert className="size-3 text-muted" aria-label="Restricted" />}
                      {z.name}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">Checkpoint</dt>
                <dd className="flex items-center gap-1.5">
                  {camera.checkpoint ? (
                    <>
                      <MapPin className="size-3.5 text-muted" aria-hidden /> {camera.checkpoint}
                    </>
                  ) : (
                    <span className="text-faint">None</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">Health</dt>
                <dd>{camera.health.status === "ok" ? "Working" : (camera.health.note ?? camera.health.status)}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">Recordings</dt>
                <dd className="tnum">{camera.segments.length} tonight</dd>
              </div>
            </dl>
          </Card>
          <Card className="p-2">
            <h2 className="px-2 pt-2 pb-1 text-[13px] font-semibold tracking-wide text-muted">Events tonight ({events.length})</h2>
            {events.length ? (
              <ul className="max-h-[420px] space-y-0.5 overflow-y-auto">
                {[...events].reverse().map((e) => (
                  <EventRow key={e.id} event={e} tz={site.timezone} showCamera={false} />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-sm text-muted">No motion recorded on this camera tonight.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Details of the event under the replay clock: AI summary, reasons, moment chips that seek. */
function NowShowing({ events, tz }: { events: CameraEvent[]; tz: string }) {
  const replay = useReplay();
  const { site } = useSite();
  const active = events.find((e) => replay.t >= ms(e.start) && replay.t <= ms(e.end)) ?? null;
  if (!active || !site) return null;
  const rel = (replay.t - ms(active.start)) / 1000;
  return (
    <Card className="mt-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SeverityPill severity={active.severity} size="sm" />
        <span className="tnum text-xs text-muted">{clock(active.start, tz)}</span>
        {active.incident_id != null && (
          <Link to={`/incidents/${active.incident_id}`} className="ml-auto text-[13px] font-medium underline underline-offset-2">
            Open incident
          </Link>
        )}
      </div>
      <p className="text-[15px] font-medium">{active.title}</p>
      {active.report && (
        <p className="mt-1 text-sm text-muted">
          {active.report.summary} <AiMark compact />
        </p>
      )}
      <ReasonChips reasons={active.reasons} size="sm" className="mt-3" />
      {(active.moments ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="AI-marked moments">
          {active.moments.map((m) => (
            <button
              key={m.t}
              onClick={() => replay.seek(ms(active.start) + m.t * 1000)}
              className={clsx(
                "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
                rel >= m.t ? "border-ai/40 bg-ai/10 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              <span className="tnum text-faint">{mmss(m.t)}</span> {m.label}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
