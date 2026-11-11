import clsx from "clsx";
import { Bell, BellOff, ChevronRight, Eye, EyeOff, Play, Siren } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CameraEvent, CameraTile, Incident, Site, Wall } from "../api/contract";
import { useBrief, useWall } from "../api/hooks";
import { AssetCard, EventRow, IncidentCard, RepeatVehicleCard, StatusSegments, lockupSummary } from "../components/domain";
import { AiMark } from "../components/markers";
import { ClipPlayer, Frame } from "../components/media";
import { NightTimeline } from "../components/NightTimeline";
import { DemoPill, LiveTile, ReplayControls, WallTile } from "../components/replay-ui";
import { EmptyState, ErrorState, SectionTitle, Skeleton } from "../components/ui";
import { useAnnotations } from "../lib/annotations";
import { playChime } from "../lib/chime";
import { useHotkeys, useIsPhone, useStoredState } from "../lib/hooks";
import { useReplay } from "../lib/replay";
import { SEVERITY } from "../lib/severity";
import { useSite } from "../lib/site";
import { armedHours, armedLabel, guardOnShift } from "../lib/status";
import { clock, hhmm, ms } from "../lib/time";

/** Incidents and events visible at replay time t (they "happen" as the clock passes them). */
function useVisible(wall: Wall | undefined, t: number) {
  return useMemo(() => {
    if (!wall) return { incidents: [] as Incident[], events: [] as CameraEvent[] };
    return {
      incidents: wall.incidents.filter((i) => ms(i.start) <= t),
      events: wall.events.filter((e) => ms(e.start) <= t),
    };
    // Re-evaluate at 1-second resolution: cheap and enough for the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wall, Math.floor(t / 1000)]);
}

function alertsByCamera(incidents: Incident[], events: CameraEvent[]) {
  const map = new Map<string, { incidentId: number; severity: "needs_look" | "unconfirmed" }>();
  for (const inc of incidents) {
    if (inc.status !== "open" || (inc.severity !== "needs_look" && inc.severity !== "unconfirmed")) continue;
    for (const e of events) {
      if (e.incident_id !== inc.id) continue;
      const prev = map.get(e.camera_id);
      if (!prev || (prev.severity === "unconfirmed" && inc.severity === "needs_look")) map.set(e.camera_id, { incidentId: inc.id, severity: inc.severity });
    }
  }
  return map;
}

export default function WallPage() {
  const phone = useIsPhone();
  const { site, night, error: siteError, refetch } = useSite();
  const wall = useWall(site?.id, night);

  if (siteError) return <ErrorState error={siteError} onRetry={refetch} className="flex-1" />;
  if (wall.error) return <ErrorState error={wall.error} onRetry={() => wall.refetch()} className="flex-1" />;
  if (!site || !wall.data) return phone ? <MobileSkeleton /> : <DesktopSkeleton />;
  return phone ? <MobileCameras site={site} wall={wall.data} /> : <DesktopWall site={site} wall={wall.data} />;
}

// ---------------------------------------------------------------------------
// Desktop wall
// ---------------------------------------------------------------------------
type WallMode = "live" | "replay";

function DesktopWall({ site, wall }: { site: Site; wall: Wall }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode: WallMode = params.get("mode") === "replay" ? "replay" : "live";
  const { t, playing, setPlaying, seek, window: win } = useReplay();
  const [annotations, setAnnotations] = useAnnotations();
  const replayVisible = useVisible(wall, t);
  const visible = mode === "live" ? { incidents: wall.incidents, events: wall.events } : replayVisible;
  const alerts = alertsByCamera(visible.incidents, visible.events);

  const setMode = (m: WallMode) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (m === "live") n.delete("mode");
        else n.set("mode", m);
        return n;
      },
      { replace: true },
    );

  useHotkeys(
    (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && wall.cameras[n - 1]) navigate(`/cameras/${wall.cameras[n - 1].id}`);
      if (mode === "replay" && e.key === " " && (e.target as HTMLElement).tagName === "BODY") {
        e.preventDefault();
        setPlaying(!playing);
      }
    },
    [wall, playing, mode],
  );

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h))] min-h-[560px]">
      <section aria-label="Camera wall" className="flex min-w-0 flex-1 flex-col p-4 lg:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Live wall</h1>
            <span className="text-sm text-muted">{wall.cameras.length} cameras</span>
            <div role="radiogroup" aria-label="Wall mode" className="ml-1 flex h-8 items-center rounded-lg bg-raised p-0.5 ring-1 ring-line-strong">
              {(
                [
                  ["live", "Live view"],
                  ["replay", "Replay"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx("h-7 rounded-md px-3 text-xs font-medium", mode === m ? "bg-fg text-canvas" : "text-muted hover:text-fg")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "replay" ? <ReplayControls tz={site.timezone} demo={site.demo} /> : site.demo && <DemoPill looping />}
            <button
              onClick={() => setAnnotations(!annotations)}
              aria-pressed={annotations}
              className={clsx("flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs ring-1 ring-line-strong", annotations ? "bg-raised text-fg" : "text-faint")}
              title="Show or hide motion boxes on video"
            >
              {annotations ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
              Boxes
            </button>
          </div>
        </div>

        <FillGrid count={wall.cameras.length}>
          {wall.cameras.map((c, i) =>
            mode === "live" ? (
              <LiveTile key={c.id} camera={c} events={wall.events} index={i + 1} alert={alerts.get(c.id) ?? null} tz={site.timezone} />
            ) : (
              <WallTile key={c.id} camera={c} events={wall.events} index={i + 1} alert={alerts.get(c.id) ?? null} tz={site.timezone} />
            ),
          )}
        </FillGrid>

        {mode === "replay" && win && (
          <div className="mt-3">
            <NightTimeline
              start={win.start}
              end={win.end}
              events={wall.events.filter((e) => e.severity !== "ignore")}
              t={t}
              tz={site.timezone}
              onSeek={seek}
              onMark={(e) => seek(ms(e.start) - 3000)}
              compact
            />
          </div>
        )}
      </section>
      <AiRail site={site} wall={wall} visible={visible} live={mode === "live"} />
    </div>
  );
}

/**
 * Fills the space between the header and the timeline. Picks the row count whose tiles are
 * closest to 16:9, spreads cameras evenly across rows (rows with fewer tiles get wider ones),
 * so the wall always uses the full width and height.
 */
function FillGrid({ count, children }: { count: number; children: React.ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(Math.max(1, Math.round(Math.sqrt(count))));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    const gap = 10;
    const compute = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      let best = { r: 1, score: Infinity };
      for (let r = 1; r <= count; r++) {
        const c = Math.ceil(count / r);
        const tw = (W - gap * (c - 1)) / c;
        const th = (H - gap * (r - 1)) / r;
        if (tw <= 0 || th <= 0) continue;
        const score = Math.abs(Math.log(tw / th / (16 / 9)));
        if (score < best.score) best = { r, score };
      }
      setRows(best.r);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  // Spread items: earlier rows take the extra tile when it doesn't divide evenly.
  const base = Math.floor(count / rows);
  const extra = count % rows;
  const out: React.ReactNode[][] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const n = base + (r < extra ? 1 : 0);
    out.push(children.slice(i, i + n));
    i += n;
  }

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-2.5">
      {out.map((row, r) => (
        <div key={r} className="flex min-h-0 flex-1 gap-2.5">
          {row.map((child, j) => (
            <div key={j} className="min-w-0 flex-1">
              {child}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI rail
// ---------------------------------------------------------------------------
function AiRail({ site, wall, visible, live }: { site: Site; wall: Wall; visible: { incidents: Incident[]; events: CameraEvent[] }; live: boolean }) {
  const replay = useReplay();
  const playing = replay.playing;
  // Live view shows the whole night, so everything has "happened".
  const t = live ? Number.MAX_SAFE_INTEGER : replay.t;
  const brief = useBrief(site.id, wall.night);
  const [chime, setChime] = useStoredState("camai.chime", false);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const openIncidents = visible.incidents.filter((i) => i.status === "open").sort((a, b) => (live ? SEVERITY[a.severity].rank - SEVERITY[b.severity].rank : 0) || b.start.localeCompare(a.start));
  const feed = [...visible.events].reverse().slice(0, 60);

  // Mark items that appear while the replay runs, chime for new incidents.
  useEffect(() => {
    if (live) {
      seen.current = null;
      return;
    }
    const ids = [...visible.incidents.map((i) => `i${i.id}`), ...visible.events.map((e) => `e${e.id}`)];
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (!added.length) return;
    added.forEach((id) => seen.current!.add(id));
    setFresh(new Set(added));
    if (chime && playing && added.some((id) => id.startsWith("i"))) playChime();
  }, [visible, chime, playing, live]);

  // Reset when site/night changes.
  useEffect(() => {
    seen.current = null;
  }, [site.id, wall.night]);

  const b = brief.data;
  const lockup = b?.lockup ?? [];
  const lockupDone = lockup.length > 0 && lockup.every((l) => ms(l.at) <= t);
  const lock = lockupSummary(lockup);
  const assets = (b?.assets ?? []).filter((a) => a.status !== "present" && a.morning && ms(a.morning.at) <= t);
  const repeats = (b?.repeat_vehicles ?? []).filter((rv) => rv.sightings.every((s) => ms(s.at) <= t));

  const status = [
    { label: live ? `Armed ${armedHours(site)}` : armedLabel(site, t), tone: undefined },
    ...(site.guarded
      ? [{ label: live ? `Guard shift ${hhmm(site.guard_shift!.from)} to ${hhmm(site.guard_shift!.to)}` : guardOnShift(site, t) ? "Guard on shift" : "No guard rostered now" }]
      : []),
    {
      label: lockup.length ? (lockupDone ? `Lock-up: ${lock.text.toLowerCase()}` : `Lock-up check at ${hhmm(site.armed.from)}`) : "No lock-up check",
      tone: lockupDone ? (lock.ok ? ("ok" as const) : ("red" as const)) : undefined,
    },
  ];

  return (
    <aside aria-label="AI insights" className="flex w-[288px] shrink-0 flex-col border-l border-line bg-surface xl:w-[var(--rail-w)]">
      <div className="border-b border-line px-4 py-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            AI insights <AiMark compact />
          </h2>
          {!live && (
          <button
            onClick={() => {
              setChime(!chime);
              if (!chime) playChime();
            }}
            aria-pressed={chime}
            className={clsx("flex h-7 items-center gap-1.5 rounded-md px-2 text-xs", chime ? "bg-raised text-fg" : "text-faint hover:text-fg")}
            title={chime ? "Mute the new-incident chime" : "Play a soft chime for new incidents"}
          >
            {chime ? <Bell className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}
            {chime ? "Chime on" : "Chime off"}
          </button>
          )}
        </div>
        <StatusSegments items={status} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <section aria-labelledby="rail-open" className="px-4 pt-4">
          <SectionTitle id="rail-open" action={<Link to="/incidents" className="text-xs text-muted hover:text-fg">All incidents</Link>}>
            Open incidents
          </SectionTitle>
          {openIncidents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted">Nothing needs a look right now.</p>
          ) : (
            <div className="space-y-2.5" aria-live="polite">
              {openIncidents.map((i) => (
                <IncidentCard key={i.id} incident={i} tz={site.timezone} fresh={fresh.has(`i${i.id}`)} keyEvent={wall.events.find((e) => e.incident_id === i.id && e.media.frames.includes(i.key_frame ?? ""))} />
              ))}
            </div>
          )}
        </section>

        {(assets.length > 0 || repeats.length > 0) && (
          <section aria-label="Checks" className="space-y-2.5 px-4 pt-5">
            {assets.map((a) => (
              <AssetCard key={a.asset} asset={a} tz={site.timezone} compact />
            ))}
            {repeats.map((rv) => (
              <RepeatVehicleCard key={rv.text} rv={rv} tz={site.timezone} compact />
            ))}
          </section>
        )}

        <section aria-labelledby="rail-feed" className="px-2 pt-5 pb-4">
          <h2 id="rail-feed" className="mb-1 px-2 text-[13px] font-semibold tracking-wide text-muted">
            Live AI feed
          </h2>
          {feed.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-muted">No motion yet tonight.</p>
          ) : (
            <ul className="space-y-0.5">
              {feed.map((e) => (
                <EventRow key={e.id} event={e} tz={site.timezone} fresh={fresh.has(`e${e.id}`)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Phones: camera list where only the tapped camera plays
// ---------------------------------------------------------------------------
function MobileCameras({ site, wall }: { site: Site; wall: Wall }) {
  // Phones are for checking the night after: show the whole night, not the replay position.
  const alerts = alertsByCamera(wall.incidents, wall.events);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cams = [...wall.cameras].sort((a, b) => Number(alerts.has(b.id)) - Number(alerts.has(a.id)));
  // Only the camera most in view plays (tapping another one also works).
  const ratios = useRef(new Map<string, number>());
  const onVisible = (id: string, ratio: number) => {
    ratios.current.set(id, ratio);
    let best: string | null = null;
    let bestRatio = 0.55;
    for (const [k, r] of ratios.current) if (r > bestRatio) [best, bestRatio] = [k, r];
    if (best) setActiveId(best);
  };

  return (
    <div className="px-3 pt-4 pb-6">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-semibold tracking-tight">Cameras</h1>
        {site.demo && <DemoPill looping />}
      </div>
      <p className="mb-4 px-1 text-[13px] text-muted">The camera in view plays its most important recording from the night. Cameras with an open incident come first.</p>
      <ul className="space-y-3">
        {cams.map((c) => (
          <MobileCameraCard
            key={c.id}
            camera={c}
            events={wall.events}
            site={site}
            active={activeId === c.id}
            onActivate={() => setActiveId(c.id)}
            onVisible={onVisible}
            alert={alerts.get(c.id) ?? null}
          />
        ))}
      </ul>
      {wall.cameras.length === 0 && <EmptyState title="No cameras on this site yet" />}
    </div>
  );
}

function MobileCameraCard({
  camera,
  events,
  site,
  active,
  onActivate,
  onVisible,
  alert,
}: {
  camera: CameraTile;
  events: CameraEvent[];
  site: Site;
  active: boolean;
  onActivate: () => void;
  onVisible: (id: string, ratio: number) => void;
  alert: { incidentId: number; severity: "needs_look" | "unconfirmed" } | null;
}) {
  const camEvents = events.filter((e) => e.camera_id === camera.id);
  const latest = camEvents[camEvents.length - 1] ?? null;
  const ref = useRef<HTMLLIElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  // Play the incident clip if there is one, otherwise the latest recording.
  const withClip = camEvents.filter((e) => e.media.clip);
  const recent =
    (alert ? withClip.find((e) => e.incident_id === alert.incidentId) : undefined) ?? withClip[withClip.length - 1] ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setOnScreen(entry.isIntersecting && entry.intersectionRatio > 0.4);
        onVisible(camera.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      },
      { threshold: [0, 0.25, 0.4, 0.55, 0.7, 0.85, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id]);

  const health = camera.health.status !== "ok" ? camera.health : null;

  return (
    <li ref={ref} className={clsx("overflow-hidden rounded-2xl border bg-surface", alert ? (alert.severity === "needs_look" ? "border-sev-red/70" : "border-sev-amber/60") : "border-line")}>
      {active && recent ? (
        <div className="p-2 pb-0">
          <ClipPlayer event={recent} suspended={!onScreen} showMoments={false} />
        </div>
      ) : (
        <button onClick={onActivate} className="relative block w-full text-left" aria-label={`Play ${camera.name}`} disabled={!recent}>
          <Frame src={camera.poster} alt="" rounded={false} className="aspect-video w-full" dim={!recent} />
          {recent && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                <Play className="size-5" aria-hidden />
              </span>
            </span>
          )}
          {!recent && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-muted">No recordings tonight</span>
            </span>
          )}
        </button>
      )}
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            {camera.name}
            {health && <span className="rounded bg-sev-amber/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#1a1205]">{health.status === "blank" ? "Blank" : health.status}</span>}
          </p>
          {latest ? (
            <p className="mt-0.5 text-[13px] text-muted">
              <span className="tnum text-faint">{clock(latest.start, site.timezone)}</span> · {latest.title} {latest.report && <AiMark compact />}
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-faint">No motion yet tonight</p>
          )}
          {alert && (
            <Link
              to={`/incidents/${alert.incidentId}`}
              className={clsx(
                "mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold",
                alert.severity === "needs_look" ? "bg-sev-red text-white" : "bg-sev-amber text-[#1a1205]",
              )}
            >
              <Siren className="size-3" aria-hidden /> {SEVERITY[alert.severity].label}
            </Link>
          )}
        </div>
        <Link to={`/cameras/${camera.id}`} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted" aria-label={`Open ${camera.name}`}>
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------
function DesktopSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h))]" aria-busy="true" aria-label="Loading cameras">
      <div className="flex-1 p-5">
        <Skeleton className="mb-4 h-8 w-80" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      </div>
      <div className="w-[var(--rail-w)] space-y-3 border-l border-line p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}

function MobileSkeleton() {
  return (
    <div className="space-y-3 px-3 pt-4" aria-busy="true" aria-label="Loading cameras">
      <Skeleton className="h-7 w-40" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="aspect-[16/12] rounded-2xl" />
      ))}
    </div>
  );
}

