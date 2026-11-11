import clsx from "clsx";
import { CircleCheck, Clock, Footprints, MapPin, Shield, ShieldAlert, Trash2, VideoOff, Wand2 } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { HealthItem, Rule, Site, Wall } from "../api/contract";
import { useDeleteRule, useHealth, useRules, useWall } from "../api/hooks";
import { Dialog } from "../components/Dialog";
import { Frame } from "../components/media";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, TonePill } from "../components/ui";
import { useSite } from "../lib/site";
import { armedHours } from "../lib/status";
import { clock, hhmm, hourLabel } from "../lib/time";
import { useToast } from "../lib/toast";

type Tab = "cameras" | "rules" | "health";

export default function SitesPage() {
  const { site, night } = useSite();
  const [params, setParams] = useSearchParams();
  const tab = (["cameras", "rules", "health"].includes(params.get("tab") ?? "") ? params.get("tab") : "cameras") as Tab;
  const wall = useWall(site?.id, night);
  const rules = useRules(site?.id);
  const health = useHealth(site?.id, night);
  const issues = health.data?.filter((h) => h.status !== "ok").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-5 md:px-6 md:py-8">
      <PageHeader title="Sites & rules" subtitle={site ? `${site.name}${site.address_hint ? ` · ${site.address_hint}` : ""}` : undefined} />
      {site && <SiteSummary site={site} />}
      <Tabs<Tab>
        className="mt-6"
        label="Site settings"
        value={tab}
        onChange={(t) =>
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              n.set("tab", t);
              return n;
            },
            { replace: true },
          )
        }
        tabs={[
          { id: "cameras", label: "Cameras & zones", count: wall.data?.cameras.length },
          { id: "rules", label: "Rules", count: rules.data?.length },
          { id: "health", label: "Health", count: issues || undefined },
        ]}
      />
      <div className="pt-5" role="tabpanel">
        {tab === "cameras" &&
          (wall.error ? <ErrorState error={wall.error} onRetry={() => wall.refetch()} /> : !wall.data ? <GridSkeleton /> : <Cameras wall={wall.data} />)}
        {tab === "rules" &&
          (rules.error ? (
            <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
          ) : !rules.data || !wall.data ? (
            <GridSkeleton />
          ) : (
            <Rules rules={rules.data} wall={wall.data} />
          ))}
        {tab === "health" &&
          (health.error ? (
            <ErrorState error={health.error} onRetry={() => health.refetch()} />
          ) : !health.data || !site ? (
            <GridSkeleton />
          ) : (
            <Health items={health.data} site={site} />
          ))}
      </div>
    </div>
  );
}

function SiteSummary({ site }: { site: Site }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
      <Card className="p-3 sm:p-4">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Shield className="size-3.5" aria-hidden /> Armed hours
        </p>
        <p className="mt-0.5 text-[15px] font-medium sm:mt-1">{armedHours(site)}</p>
        <p className="mt-0.5 hidden text-xs text-faint sm:block">From the site clock. Ajax arming state plugs in here later.</p>
      </Card>
      <Card className="p-3 sm:p-4">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Footprints className="size-3.5" aria-hidden /> Guard shift
        </p>
        <p className="mt-0.5 text-[15px] font-medium sm:mt-1">{site.guard_shift ? `${hhmm(site.guard_shift.from)} to ${hhmm(site.guard_shift.to)}` : "No guards"}</p>
        <p className="mt-0.5 hidden text-xs text-faint sm:block">{site.guarded ? "Security uniform seen on shift counts as a patrol." : "Anyone seen while armed is flagged."}</p>
      </Card>
      <Card className="p-3 sm:p-4">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Clock className="size-3.5" aria-hidden /> Timezone
        </p>
        <p className="mt-0.5 text-[15px] font-medium sm:mt-1">{site.timezone.replace("_", " ")}</p>
        <p className="mt-0.5 hidden text-xs text-faint sm:block">All times on this site are shown in this zone.</p>
      </Card>
    </div>
  );
}

function Cameras({ wall }: { wall: Wall }) {
  if (!wall.cameras.length) return <EmptyState title="No cameras yet">Cameras appear here once they're connected.</EmptyState>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {wall.cameras.map((c) => (
        <li key={c.id} className="card overflow-hidden">
          <Link to={`/cameras/${c.id}`} className="block" aria-label={`Open ${c.name}`}>
            <Frame src={c.poster} alt="" rounded={false} className="aspect-video w-full" />
          </Link>
          <div className="p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{c.name}</p>
              {c.health.status === "ok" ? (
                <span className="flex items-center gap-1 text-xs text-ok-fg">
                  <CircleCheck className="size-3.5" aria-hidden /> Working
                </span>
              ) : (
                <TonePill tone="amber" size="sm">
                  {c.health.status === "blank" ? "Blank" : c.health.status}
                </TonePill>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {c.zones.map((z) => (
                <span
                  key={z.name}
                  className={clsx("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs", z.restricted ? "bg-overlay text-fg ring-1 ring-line-strong" : "bg-raised text-muted")}
                >
                  {z.restricted && <ShieldAlert className="size-3" aria-hidden />}
                  {z.name}
                  {z.restricted && <span className="sr-only">(restricted)</span>}
                </span>
              ))}
            </div>
            {c.checkpoint && (
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
                <MapPin className="size-3.5" aria-hidden /> Guard checkpoint: {c.checkpoint}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ruleHours(r: Rule) {
  const to = (r.hour_to + 1) % 24;
  return `${hourLabel(r.hour_from)} to ${hourLabel(to)}`;
}

function Rules({ rules, wall }: { rules: Rule[]; wall: Wall }) {
  const del = useDeleteRule();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Rule | null>(null);
  const camName = (id: string) => wall.cameras.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Rules hide recurring things you've said aren't a problem. They never hide a person seen while the site is armed.
      </p>
      {rules.length === 0 ? (
        <EmptyState icon={<Wand2 className="size-5" />} title="No rules yet">
          Open any event and choose "Create a rule…" to stop seeing it every night. You'll see exactly what it hides before saving.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{r.note}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  <span>{camName(r.camera_id)}</span>
                  <span className="tnum">{ruleHours(r)}</span>
                  <span>Added {new Date(r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(r)} aria-label={`Delete rule: ${r.note}`}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this rule?"
        description="Events it was hiding will show again from now on."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={del.isPending}
              onClick={() =>
                confirm &&
                del.mutate(confirm.id, {
                  onSuccess: () => {
                    toast({ text: "Rule deleted", tone: "ok" });
                    setConfirm(null);
                  },
                  onError: (e) => toast({ text: (e as Error).message, tone: "error" }),
                })
              }
            >
              Delete rule
            </Button>
          </>
        }
      >
        <p className="rounded-lg border border-line bg-canvas/50 p-3 text-sm">{confirm?.note}</p>
      </Dialog>
    </>
  );
}

function Health({ items, site }: { items: HealthItem[]; site: Site }) {
  const sorted = [...items].sort((a, b) => Number(a.status === "ok") - Number(b.status === "ok"));
  const bad = items.filter((i) => i.status !== "ok");
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {bad.length === 0 ? "All cameras are working." : `${bad.length} camera${bad.length === 1 ? " needs" : "s need"} attention. A blank or moved camera also stops patrol checks and lock-up checks on that view.`}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sorted.map((h) => (
          <li key={h.camera_id} className={clsx("card flex gap-3 p-3", h.status !== "ok" && "border-sev-amber/50")}>
            {h.status === "ok" ? (
              <Frame src={h.image} alt="" className="aspect-video w-28 shrink-0" />
            ) : (
              <div className="flex aspect-video w-28 shrink-0 items-center justify-center rounded-lg bg-black text-sev-amber">
                <VideoOff className="size-5" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {h.camera_name}
                {h.status === "ok" ? (
                  <span className="text-xs font-normal text-ok-fg">Working</span>
                ) : (
                  <TonePill tone="amber" size="sm">
                    {h.status === "blank" ? "View blank" : h.status === "moved" ? "Moved" : "Offline"}
                  </TonePill>
                )}
              </p>
              {h.note && <p className="mt-1 text-[13px] text-muted">{h.note}</p>}
              {h.since && <p className="tnum mt-1 text-xs text-faint">Since {clock(h.since, site.timezone)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-56" />
      ))}
    </div>
  );
}
