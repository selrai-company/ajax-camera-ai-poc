import clsx from "clsx";
import { EyeOff, Footprints, Inbox, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { CameraEvent, Site } from "../api/contract";
import { useBrief, useIncidents, useWall } from "../api/hooks";
import { AssetCard, IncidentCard, RepeatVehicleCard, eventHref } from "../components/domain";
import { AiMark, ReasonChips } from "../components/markers";
import { EventFrame } from "../components/media";
import { EmptyState, ErrorState, PageHeader, SectionTitle, SeverityPill, Skeleton, Tabs } from "../components/ui";
import { useSite } from "../lib/site";
import { clock, nightDay } from "../lib/time";

type Tab = "needs" | "fyi" | "ignored";

export default function IncidentsPage() {
  const { site, night } = useSite();
  const [params, setParams] = useSearchParams();
  const tab = (["needs", "fyi", "ignored"].includes(params.get("tab") ?? "") ? params.get("tab") : "needs") as Tab;
  const incidents = useIncidents(site?.id, night);
  const wall = useWall(site?.id, night);
  const brief = useBrief(site?.id, night);

  const events = wall.data?.events ?? [];
  const fyi = events.filter((e) => !e.dismissed && (e.severity === "fyi" || e.severity === "camera_issue" || (e.severity === "unconfirmed" && e.incident_id == null)));
  const ignored = events.filter((e) => e.severity === "ignore" || e.dismissed);
  const guardCount = events.filter((e) => e.severity === "guard").length;
  const list = incidents.data ?? [];
  const open = list.filter((i) => i.status === "open");
  const closed = list.filter((i) => i.status !== "open");
  const assets = (brief.data?.assets ?? []).filter((a) => a.status === "missing" || a.status === "unclear");
  const repeats = brief.data?.repeat_vehicles ?? [];

  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("tab", t);
        return n;
      },
      { replace: true },
    );

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-5 md:px-6 md:py-8">
      <PageHeader title="Incidents" subtitle={site && night ? `${site.name} · ${nightDay(night)} night` : undefined} />
      <Tabs<Tab>
        label="Incident categories"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "needs", label: "Needs a look", count: incidents.data ? open.length : undefined },
          { id: "fyi", label: "FYI", count: wall.data ? fyi.length + repeats.length : undefined },
          { id: "ignored", label: "Ignored", count: wall.data ? ignored.length : undefined },
        ]}
      />

      <div className="pt-5" role="tabpanel">
        {tab === "needs" &&
          (incidents.error ? (
            <ErrorState error={incidents.error} onRetry={() => incidents.refetch()} />
          ) : !incidents.data || !site ? (
            <ListSkeleton />
          ) : (
            <div className="space-y-6">
              {open.length === 0 ? (
                <EmptyState icon={<ShieldCheck className="size-5" />} title="Quiet night. Nothing needed a look.">
                  {closed.length ? "Everything from last night has been handled." : "The FYI and Ignored tabs show what the AI checked and why."}
                </EmptyState>
              ) : (
                <section aria-label="Open incidents" className="space-y-3">
                  {open.map((i) => (
                    <IncidentCard key={i.id} incident={i} tz={site.timezone} variant="list" />
                  ))}
                </section>
              )}
              {assets.length > 0 && (
                <section aria-label="Equipment check">
                  <SectionTitle>Equipment check</SectionTitle>
                  <div className="grid gap-3 md:grid-cols-2">
                    {assets.map((a) => (
                      <AssetCard key={a.asset} asset={a} tz={site.timezone} />
                    ))}
                  </div>
                </section>
              )}
              {closed.length > 0 && (
                <section>
                  <SectionTitle>Handled and dismissed</SectionTitle>
                  <div className="space-y-3">
                    {closed.map((i) => (
                      <IncidentCard key={i.id} incident={i} tz={site.timezone} variant="list" />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ))}

        {tab === "fyi" &&
          (wall.error ? (
            <ErrorState error={wall.error} onRetry={() => wall.refetch()} />
          ) : !wall.data || !site ? (
            <ListSkeleton />
          ) : (
            <div className="space-y-5">
              {repeats.map((rv) => (
                <RepeatVehicleCard key={rv.text} rv={rv} tz={site.timezone} />
              ))}
              {fyi.length === 0 && repeats.length === 0 ? (
                <EmptyState icon={<Inbox className="size-5" />} title="Nothing to know about">
                  No deliveries, vehicles while armed or camera issues last night.
                </EmptyState>
              ) : (
                <EventList events={fyi} site={site} />
              )}
              {site.guarded && guardCount > 0 && (
                <Link to="/patrols" className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:bg-raised">
                  <Footprints className="size-4 text-sev-blue" aria-hidden />
                  <span>
                    <span className="tnum font-medium">{guardCount}</span> guard patrol visits are on the Patrols page.
                  </span>
                </Link>
              )}
            </div>
          ))}

        {tab === "ignored" &&
          (wall.error ? (
            <ErrorState error={wall.error} onRetry={() => wall.refetch()} />
          ) : !wall.data || !site ? (
            <ListSkeleton />
          ) : ignored.length === 0 ? (
            <EmptyState icon={<EyeOff className="size-5" />} title="Nothing ignored">
              Every event last night was shown.
            </EmptyState>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">
                The AI looked at these and the site rules set them aside. Each one shows why, so you can check nothing important was hidden.
              </p>
              <EventList events={ignored} site={site} muted />
            </>
          ))}
      </div>
    </div>
  );
}

function EventList({ events, site, muted }: { events: CameraEvent[]; site: Site; muted?: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {events.map((e) => (
        <li key={e.id}>
          <Link to={eventHref(e)} className="flex gap-3 p-3 transition-colors hover:bg-raised md:gap-4 md:p-4">
            <EventFrame event={e} className={clsx("aspect-video w-28 shrink-0 md:w-36", muted && "opacity-75")} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <SeverityPill severity={e.dismissed ? "ignore" : e.severity} size="sm" />
                <span className="tnum text-xs text-muted">{clock(e.start, site.timezone)}</span>
                <span className="text-xs text-faint">{e.camera_name}</span>
                {e.dismissed && <span className="text-xs text-faint">· Dismissed by you</span>}
              </div>
              <p className={clsx("text-sm font-medium", muted ? "text-muted" : "text-fg")}>
                {e.title} {e.report && <AiMark compact />}
              </p>
              <ReasonChips reasons={e.reasons} size="sm" className="mt-2" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}
