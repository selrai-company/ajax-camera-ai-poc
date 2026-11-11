import clsx from "clsx";
import { Check, CircleDashed, Clock, EyeOff, Footprints, Info, Lock, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { CameraEvent, PatrolVisit, Patrols, Site } from "../api/contract";
import { usePatrols, useWall } from "../api/hooks";
import { eventHref } from "../components/domain";
import { EventFrame } from "../components/media";
import { Card, EmptyState, ErrorState, PageHeader, SectionTitle, Skeleton } from "../components/ui";
import { useSite } from "../lib/site";
import { clock, nightDay, span } from "../lib/time";

const STATE: Record<PatrolVisit["status"], { label: string; icon: typeof Check; cls: string }> = {
  visited: { label: "Visited", icon: Check, cls: "border-sev-blue/50 bg-sev-blue/14 text-sev-blue-fg" },
  missed: { label: "Missed", icon: X, cls: "border-sev-amber/60 bg-sev-amber/12 text-sev-amber-fg" },
  unverifiable: { label: "Couldn't verify", icon: EyeOff, cls: "border-dashed border-line-strong bg-transparent text-muted" },
  upcoming: { label: "Upcoming", icon: Clock, cls: "border-dashed border-line bg-transparent text-faint" },
};

export default function PatrolsPage() {
  const { site, night } = useSite();
  const q = usePatrols(site?.id, night, !!site?.guarded);
  const wall = useWall(site?.id, night);

  if (site && !site.guarded) {
    return (
      <EmptyState icon={<Footprints className="size-5" />} title="No guard patrols at this site" className="flex-1">
        {site.name} doesn't have guards rostered. Patrol checks appear for sites with a guard shift.
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-5 md:px-6 md:py-8">
      <PageHeader
        title="Guard patrols"
        subtitle={
          site && night && q.data?.shift
            ? `${site.name} · ${nightDay(night)} night · shift ${clock(q.data.shift.start, site.timezone)} to ${clock(q.data.shift.end, site.timezone)}`
            : undefined
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || !site ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <PatrolBody p={q.data} site={site} events={wall.data?.events ?? []} />
      )}
    </div>
  );
}

function PatrolBody({ p, site, events }: { p: Patrols; site: Site; events: CameraEvent[] }) {
  const tz = site.timezone;
  const byId = new Map(events.map((e) => [e.id, e]));
  const finished = p.rounds.flatMap((r) => Object.values(r.visits)).filter((v) => v.status !== "upcoming");
  const visited = finished.filter((v) => v.status === "visited").length;
  const missed = finished.filter((v) => v.status === "missed").length;
  const unverifiable = finished.filter((v) => v.status === "unverifiable").length;

  const lastVisit = (cpId: string) => {
    let best: PatrolVisit | null = null;
    for (const r of p.rounds) {
      const v = r.visits[cpId];
      if (v?.status === "visited" && v.at && (!best || v.at > best.at!)) best = v;
    }
    return best;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Coverage</p>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight">{p.coverage_pct != null ? `${p.coverage_pct}%` : "–"}</p>
          <p className="mt-1 text-xs text-faint">Confirmed visits of rounds finished</p>
        </Card>
        <Stat label="Visited" value={visited} cls="text-sev-blue-fg" />
        <Stat label="Missed" value={missed} cls={missed ? "text-sev-amber-fg" : "text-fg"} />
        <Stat label="Couldn't verify" value={unverifiable} cls="text-muted" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">Checkpoints by round</h2>
          <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
            {(Object.keys(STATE) as PatrolVisit["status"][]).map((k) => {
              const S = STATE[k];
              return (
                <li key={k} className="flex items-center gap-1.5">
                  <span className={clsx("flex size-5 items-center justify-center rounded border", S.cls)}>
                    <S.icon className="size-3" aria-hidden />
                  </span>
                  {S.label}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium">
                  Checkpoint
                </th>
                {p.rounds.map((r) => (
                  <th key={r.label} scope="col" className="px-2 py-3 font-medium">
                    {r.label}
                    <span className="tnum block font-normal text-faint">
                      {clock(r.window.start, tz)}–{clock(r.window.end, tz)}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 font-medium">
                  Last confirmed visit
                </th>
              </tr>
            </thead>
            <tbody>
              {p.checkpoints.map((cp) => {
                const last = lastVisit(cp.id);
                const lastEv = last?.event_id != null ? byId.get(last.event_id) : undefined;
                return (
                  <tr key={cp.id} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium">
                      {cp.name}
                    </th>
                    {p.rounds.map((r) => {
                      const v = r.visits[cp.id] ?? { status: "upcoming", event_id: null, at: null };
                      const S = STATE[v.status];
                      const ev = v.event_id != null ? byId.get(v.event_id) : undefined;
                      const content = (
                        <>
                          <S.icon className="size-3.5 shrink-0" aria-hidden />
                          <span className="tnum">{v.status === "visited" && v.at ? clock(v.at, tz) : S.label}</span>
                        </>
                      );
                      return (
                        <td key={r.label} className="px-2 py-2.5">
                          {ev ? (
                            <Link
                              to={eventHref(ev)}
                              className={clsx("flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors hover:brightness-125", S.cls)}
                              aria-label={`${cp.name}, ${r.label}: visited at ${clock(v.at!, tz)}. View evidence`}
                            >
                              {content}
                            </Link>
                          ) : (
                            <span className={clsx("flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]", S.cls)} aria-label={`${cp.name}, ${r.label}: ${S.label}`}>
                              {content}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      {last && lastEv ? (
                        <Link to={eventHref(lastEv)} className="flex items-center gap-2.5 rounded-lg hover:bg-raised">
                          <EventFrame event={lastEv} className="aspect-video w-16 shrink-0 rounded-md" />
                          <span className="tnum text-[13px]">{clock(last.at!, tz)}</span>
                        </Link>
                      ) : (
                        <span className="text-[13px] text-faint">None tonight</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-4 md:p-5">
          <SectionTitle>Patrol insights</SectionTitle>
          {p.insights.length ? (
            <ul className="space-y-2">
              {p.insights.map((i) => {
                const ev = i.event_id != null ? byId.get(i.event_id) : undefined;
                return (
                  <li key={i.text} className="flex items-start gap-3 rounded-xl border border-line bg-canvas/40 p-3">
                    <span
                      className={clsx(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        i.severity === "needs_look" ? "bg-sev-red" : i.severity === "fyi" ? "bg-sev-amber" : "bg-sev-blue",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg">{i.text}</p>
                      {ev ? (
                        <Link to={eventHref(ev)} className="mt-1 inline-block text-xs text-muted underline underline-offset-2 hover:text-fg">
                          Evidence: {ev.camera_name}, {clock(ev.start, tz)}
                        </Link>
                      ) : null}
                    </div>
                    {ev && <EventFrame event={ev} className="hidden aspect-video w-24 shrink-0 sm:block" />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing to flag. Every round covered every checkpoint.</p>
          )}
          {missed > 0 && p.shift && (
            <p className="mt-3 text-xs text-faint">Shift length {span(Date.parse(p.shift.start), Date.parse(p.shift.end))}. Rounds count as missed when no visit is seen on the checkpoint camera during the round window.</p>
          )}
        </Card>

        <aside className="rounded-[var(--radius-card)] border border-line bg-surface/60 p-4 text-[13px] text-muted">
          <p className="mb-2 flex items-center gap-2 font-medium text-fg">
            <Lock className="size-4" aria-hidden /> Privacy
          </p>
          <p>{p.privacy_note}</p>
          <ul className="mt-3 space-y-1.5">
            <li className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Site coverage, not people: no names and no per-guard scores.
            </li>
            <li className="flex gap-2">
              <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Only the defined checkpoints, per site, per shift.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx("tnum mt-1 text-3xl font-semibold tracking-tight", cls)}>{value}</p>
    </Card>
  );
}
