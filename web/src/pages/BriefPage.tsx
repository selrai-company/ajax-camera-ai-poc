import clsx from "clsx";
import { ChevronDown, Footprints, Lock, PackageSearch, Truck, VideoOff } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Brief, Site } from "../api/contract";
import { useBrief } from "../api/hooks";
import { AssetCard, IncidentCard, LockupList, RepeatVehicleCard, SeeAll, SuggestionCard, eventHref, lockupSummary } from "../components/domain";
import { SourceMark } from "../components/markers";
import { EventFrame } from "../components/media";
import { NightSelect } from "../components/NightSelect";
import { ErrorState, Skeleton, TonePill } from "../components/ui";
import { BRIEF_STATUS, TONE } from "../lib/severity";
import { useSite } from "../lib/site";
import { clock, nightDay } from "../lib/time";

export default function BriefPage() {
  const { site, night } = useSite();
  const q = useBrief(site?.id, night);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 md:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">Morning brief{night ? ` · ${nightDay(night)} night` : ""}</p>
          <h1 className="mt-0.5 text-[22px] leading-tight font-semibold tracking-tight md:text-[26px]">
            {site ? `Last night at ${site.name}` : <Skeleton className="h-7 w-72" />}
          </h1>
        </div>
        <NightSelect className="md:hidden" />
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || !site ? (
        <BriefSkeleton />
      ) : (
        <BriefBody b={q.data} site={site} />
      )}
    </div>
  );
}

function Section({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function BriefBody({ b, site }: { b: Brief; site: Site }) {
  const tz = site.timezone;
  const st = BRIEF_STATUS[b.status];
  const tone = TONE[st.tone];
  const open = b.incidents.filter((i) => i.status === "open");
  const closed = b.incidents.filter((i) => i.status !== "open");
  const lock = lockupSummary(b.lockup);
  const assetsSorted = [...b.assets].sort((a, c) => Number(c.status === "missing") - Number(a.status === "missing"));
  const assetProblems = b.assets.filter((a) => a.status !== "present").length;

  return (
    <>
      {/* Headline */}
      <section className={clsx("relative overflow-hidden rounded-2xl border bg-surface p-5 md:p-6", tone.border)} aria-label="Summary">
        <span className={clsx("absolute inset-y-0 left-0 w-1", tone.solid)} aria-hidden />
        <div className="mb-3 flex items-center gap-2">
          <TonePill tone={st.tone}>{st.label}</TonePill>
          {open.length > 0 && (
            <span className="text-[13px] text-muted">
              {open.length} open incident{open.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-[19px] leading-snug font-medium text-balance text-fg md:text-[21px]">
          {b.headline} <SourceMark source={b.headline_by} compact className="ml-0.5" />
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
          <Stat label="Open incidents" value={open.length} tone={open.length ? "red" : undefined} />
          <Stat label="Lock-up" value={b.lockup.length ? (lock.ok ? "OK" : lock.text) : "–"} tone={b.lockup.length ? (lock.ok ? "ok" : "red") : undefined} />
          {b.patrol ? (
            <Stat label="Patrol coverage" value={b.patrol.coverage_pct != null ? `${b.patrol.coverage_pct}%` : "–"} tone={b.patrol.missed.length ? "amber" : "ok"} />
          ) : (
            <Stat label="Ignored" value={b.ignored.count} />
          )}
        </dl>
      </section>

      {open.length > 0 && (
        <Section title="Needs a look" action={<SeeAll to="/incidents">All incidents</SeeAll>}>
          <div className="space-y-4">
            {open.map((i) => (
              <IncidentCard key={i.id} incident={i} tz={tz} variant="brief" />
            ))}
          </div>
        </Section>
      )}

      {b.assets.length > 0 && (
        <Section title="Equipment check" icon={<PackageSearch className="size-4 text-muted" aria-hidden />} action={assetProblems ? undefined : <span className="text-[13px] text-ok-fg">All in place</span>}>
          <div className="space-y-3">
            {assetsSorted.map((a) => (
              <AssetCard key={a.asset} asset={a} tz={tz} compact={a.status === "present"} />
            ))}
          </div>
        </Section>
      )}

      {b.repeat_vehicles.length > 0 && (
        <Section title="Vehicles seen again">
          <div className="space-y-3">
            {b.repeat_vehicles.map((rv) => (
              <RepeatVehicleCard key={rv.text} rv={rv} tz={tz} />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Lock-up check"
        icon={<Lock className="size-4 text-muted" aria-hidden />}
        action={b.lockup.length ? <span className={clsx("text-[13px]", lock.ok ? "text-ok-fg" : "text-sev-red-fg")}>{lock.ok ? `All ${b.lockup.length} OK` : lock.text}</span> : undefined}
      >
        <LockupList checks={b.lockup} tz={tz} />
      </Section>

      {b.patrol && (
        <Section title="Guard patrols" icon={<Footprints className="size-4 text-sev-blue" aria-hidden />} action={<SeeAll to="/patrols">Patrol grid</SeeAll>}>
          <div className="card p-4">
            <div className="flex items-baseline gap-2">
              <span className="tnum text-3xl font-semibold tracking-tight">{b.patrol.coverage_pct ?? "–"}%</span>
              <span className="text-sm text-muted">of due checkpoint visits confirmed</span>
            </div>
            {b.patrol.missed.length ? (
              <ul className="mt-3 space-y-1.5">
                {b.patrol.missed.map((m) => (
                  <li key={m.text} className="flex items-start gap-2 text-sm">
                    <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", m.severity === "needs_look" ? "bg-sev-red" : "bg-sev-amber")} aria-hidden />
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Every round covered every checkpoint.</p>
            )}
          </div>
        </Section>
      )}

      {b.deliveries.length > 0 && (
        <Section title="Deliveries" icon={<Truck className="size-4 text-muted" aria-hidden />}>
          <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 scrollbar-none">
            {b.deliveries.map((d) => (
              <li key={d.id} className="w-56 shrink-0 snap-start">
                <Link to={eventHref(d)} className="block rounded-xl border border-line bg-surface p-1.5 hover:bg-raised">
                  <EventFrame event={d} className="aspect-video w-full" />
                  <p className="mt-1.5 px-1 text-[13px] leading-snug">{d.title}</p>
                  <p className="tnum px-1 pb-1 text-xs text-faint">
                    {clock(d.start, tz)} · {d.camera_name}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {b.health.length > 0 && (
        <Section title="Camera health" icon={<VideoOff className="size-4 text-sev-amber" aria-hidden />} action={<SeeAll to="/sites?tab=health">Health</SeeAll>}>
          <ul className="space-y-2">
            {b.health.map((h) => (
              <li key={h.camera_id} className="rounded-xl border border-sev-amber/40 bg-surface p-3 text-sm">
                <p className="font-medium">
                  {h.camera_name}: <span className="text-sev-amber-fg">{h.status === "blank" ? "view blank" : h.status}</span>
                </p>
                {h.note && <p className="mt-0.5 text-[13px] text-muted">{h.note}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {b.suggestions.length > 0 && (
        <Section title="Suggested rules">
          <div className="space-y-3">
            {b.suggestions.map((s) => (
              <SuggestionCard key={`${s.camera_id}-${s.activity_label}`} s={s} site={site} />
            ))}
          </div>
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Handled">
          <div className="space-y-3">
            {closed.map((i) => (
              <IncidentCard key={i.id} incident={i} tz={tz} variant="list" />
            ))}
          </div>
        </Section>
      )}

      <section className="mt-8 space-y-2">
        <Collapse title="FYI" count={b.fyi.length}>
          {b.fyi.length ? (
            <ul className="divide-y divide-line">
              {b.fyi.map((e) => (
                <li key={e.id}>
                  <Link to={eventHref(e)} className="flex gap-3 py-2.5 hover:text-fg">
                    <span className="tnum w-16 shrink-0 text-[13px] text-muted">{clock(e.start, tz)}</span>
                    <span className="text-sm">
                      {e.title} <span className="text-faint">· {e.camera_name}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted">Nothing else worth knowing.</p>
          )}
        </Collapse>
        <Collapse title="Checked and ignored" count={b.ignored.count}>
          <ul className="space-y-1.5 py-1">
            {Object.entries(b.ignored.reasons)
              .sort((a, c) => c[1] - a[1])
              .map(([reason, n]) => (
                <li key={reason} className="flex justify-between text-sm">
                  <span className="text-muted">{reason}</span>
                  <span className="tnum text-fg">{n}</span>
                </li>
              ))}
          </ul>
          <Link to="/incidents?tab=ignored" className="mt-2 inline-block text-[13px] text-muted underline underline-offset-2 hover:text-fg">
            See each one and why
          </Link>
        </Collapse>
      </section>

      <p className="mt-8 text-center text-xs text-faint">
        AI cost for this night: about {b.est_cost_usd < 0.01 ? "under 1c" : `${Math.round(b.est_cost_usd * 100)}c`} (USD)
      </p>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "ok" }) {
  return (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className={clsx("tnum mt-0.5 text-lg font-semibold", tone ? TONE[tone].text : "text-fg")}>{value}</dd>
    </div>
  );
}

function Collapse({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="group card px-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between text-sm font-medium">
        <span>
          {title} <span className="tnum ml-1 text-muted">{count}</span>
        </span>
        <ChevronDown className="size-4 text-faint transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function BriefSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading brief">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="aspect-video rounded-2xl" />
      <Skeleton className="h-24" />
    </div>
  );
}
