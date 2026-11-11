import clsx from "clsx";
import { ArrowRight, Check, CircleHelp, Ellipsis, FileText, Phone, RotateCcw, Siren, ThumbsUp, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CameraEvent, IncidentDetail, Site } from "../api/contract";
import { evidencePackUrl } from "../api";
import { useDismissEvents, useIncident, useSetIncidentStatus } from "../api/hooks";
import { AiMark, ReasonChips, SourceLegend } from "../components/markers";
import { ClipPlayer, EventFrame } from "../components/media";
import { RuleDialog } from "../components/RuleDialog";
import { Button, buttonClass, Card, EmptyState, ErrorState, SectionTitle, SeverityPill, Skeleton, TonePill } from "../components/ui";
import { useSite } from "../lib/site";
import { SEVERITY, toneOf } from "../lib/severity";
import { clock, clockRange, mmss, nightDay } from "../lib/time";
import { useToast } from "../lib/toast";

const nightOf = (iso: string) => {
  const date = iso.slice(0, 10);
  if (Number(iso.slice(11, 13)) >= 12) return date;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export default function IncidentPage() {
  const id = Number(useParams().id);
  const q = useIncident(id);
  const { sites, site, setSite } = useSite();

  useEffect(() => {
    if (q.data && site && q.data.site_id !== site.id && sites.some((s) => s.id === q.data!.site_id)) setSite(q.data.site_id);
  }, [q.data, site, sites, setSite]);

  if (q.error) {
    const notFound = (q.error as { status?: number }).status === 404;
    return notFound ? (
      <EmptyState
        title="Incident not found"
        action={
          <Link to="/incidents" className={buttonClass("secondary", "sm")}>
            All incidents
          </Link>
        }
      >
        It may have been removed, or the link is from another system.
      </EmptyState>
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} className="flex-1" />
    );
  }
  const incSite = sites.find((s) => s.id === q.data?.site_id) ?? site;
  if (!q.data || !incSite) return <IncidentSkeleton />;
  return <IncidentView inc={q.data} site={incSite} />;
}

function IncidentView({ inc, site }: { inc: IncidentDetail; site: Site }) {
  const tz = site.timezone;
  const [selectedId, setSelectedId] = useState<number>(inc.events[0]?.id);
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const selected = inc.events.find((e) => e.id === selectedId) ?? inc.events[0];
  const keyEvent = inc.events.find((e) => e.media.key_frame === inc.key_frame) ?? inc.events[0];

  const pick = (e: CameraEvent, t = 0) => {
    setSelectedId(e.id);
    setSeek({ t, nonce: Date.now() });
  };

  // First appearance per camera, for the cross-camera sequence.
  const sequence = inc.cameras.map((c) => inc.events.find((e) => e.camera_id === c.id)!).filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-3 pt-4 pb-40 md:px-6 md:pt-6 md:pb-28">
      <Link to="/incidents" className="mb-3 inline-flex text-[13px] text-muted hover:text-fg">
        ← Incidents
      </Link>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SeverityPill severity={inc.severity} />
        {inc.status !== "open" && <TonePill tone="grey">{inc.status === "handled" ? "Handled" : "Dismissed"}</TonePill>}
        <span className="tnum text-sm text-muted">
          {clockRange(inc.start, inc.end, tz)} · {nightDay(nightOf(inc.start))} night · {site.name}
        </span>
      </div>
      <h1 className="max-w-4xl text-[21px] leading-snug font-semibold tracking-tight text-balance md:text-[26px]">
        {inc.headline} {inc.headline_by === "ai" && <AiMark className="ml-1 align-[0.2em]" />}
      </h1>

      {inc.alarm && (
        <div
          className={clsx(
            "mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3",
            inc.alarm.verdict === "person_visible" || inc.alarm.verdict === "vehicle_visible" ? "border-sev-red/50 bg-sev-red/10" : "border-line-strong bg-raised",
          )}
          role="note"
        >
          <Siren className="size-4 shrink-0 text-sev-red" aria-hidden />
          <span className="text-sm font-semibold">
            Ajax alarm <span className="tnum">{clock(inc.alarm.at, tz)}</span> · {inc.alarm.zone}
          </span>
          <span className="text-sm text-fg">{inc.alarm.verdict_text}</span>
          {inc.alarm.simulated && (
            <span className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-muted" title="The Ajax alarm feed is simulated until the Enterprise API is connected">
              Simulated alarm feed
            </span>
          )}
        </div>
      )}

      {/* Media: key frame next to the clip (stacked on phones, frame first) */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <figure className="min-w-0">
          {keyEvent ? <EventFrame event={keyEvent} label className="aspect-video w-full" /> : <Skeleton className="aspect-video" />}
          <figcaption className="mt-2 text-xs text-muted">
            Key frame · {keyEvent?.camera_name} · <span className="tnum">{keyEvent && clock(keyEvent.start, tz)}</span>
          </figcaption>
        </figure>
        <div className="min-w-0">
          {selected ? (
            <>
              <ClipPlayer event={selected} seek={seek} />
              <p className="mt-1 text-xs text-muted">
                Clip · {selected.camera_name} · <span className="tnum">{clock(selected.start, tz)}</span>
              </p>
            </>
          ) : (
            <EmptyState title="No clips for this incident" />
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-4 md:p-5">
            <SectionTitle>Why this {inc.severity === "needs_look" ? "needs a look" : `is ${SEVERITY[inc.severity].label.toLowerCase()}`}</SectionTitle>
            <ReasonChips reasons={inc.why} max={8} expandable />
            {inc.cant_tell.length > 0 && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-canvas/50 px-3 py-2.5 text-sm text-muted">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
                <span>
                  <span className="font-medium text-fg">AI couldn't tell:</span> {inc.cant_tell.join("; ")}.
                </span>
              </p>
            )}
            <SourceLegend className="mt-4" />
          </Card>

          {sequence.length > 1 && (
            <Card className="p-4 md:p-5">
              <SectionTitle>
                Same time window, {sequence.length} cameras
              </SectionTitle>
              <ol className="-mx-1 flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto px-1 pb-1 scrollbar-none" aria-label="Cross-camera sequence">
                {sequence.map((e, i) => (
                  <li key={e.id} className="flex shrink-0 snap-start items-center gap-2">
                    <button
                      onClick={() => pick(e)}
                      aria-pressed={selected?.id === e.id}
                      className={clsx(
                        "w-44 rounded-xl border p-1.5 text-left transition-colors md:w-48",
                        selected?.id === e.id ? "border-fg/70 bg-raised" : "border-line hover:bg-raised",
                      )}
                    >
                      <EventFrame event={e} className="aspect-video w-full" />
                      <span className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5">
                        <span className="truncate text-[13px] font-medium">{e.camera_name}</span>
                        <span className="tnum shrink-0 text-xs text-muted">{clock(e.start, tz)}</span>
                      </span>
                    </button>
                    {i < sequence.length - 1 && <ArrowRight className="size-4 shrink-0 text-faint" aria-hidden />}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-faint">Linked by time and place only. The system doesn't identify people, so it never says "same person".</p>
            </Card>
          )}

          <Card className="p-4 md:p-5">
            <SectionTitle>What happened · AI-marked moments</SectionTitle>
            <ol className="relative space-y-1 border-l border-line pl-5">
              {inc.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={clsx("absolute top-3 -left-[25px] size-2.5 rounded-full ring-4 ring-surface", toneOf(e.severity).dot)} aria-hidden />
                  <button
                    onClick={() => pick(e)}
                    className={clsx("w-full rounded-lg px-3 py-2 text-left transition-colors", selected?.id === e.id ? "bg-raised" : "hover:bg-raised/60")}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tnum text-xs text-muted">{clock(e.start, tz)}</span>
                      <span className="text-xs text-faint">{e.camera_name}</span>
                      {e.dismissed && <span className="text-xs text-faint">· dismissed</span>}
                    </span>
                    <span className="mt-0.5 block text-sm font-medium">{e.title}</span>
                    {e.report && (
                      <span className="mt-0.5 block text-[13px] text-muted">
                        {e.report.summary} <AiMark compact />
                      </span>
                    )}
                  </button>
                  {(e.moments ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                      {e.moments.map((m) => (
                        <button
                          key={m.t}
                          onClick={() => pick(e, m.t)}
                          className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted hover:border-ai/40 hover:text-fg"
                        >
                          <span className="tnum text-faint">{mmss(m.t)}</span> {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <SectionTitle>Details</SectionTitle>
            <dl className="space-y-2.5 text-sm">
              <Row label="Status">{inc.status === "open" ? "Open" : inc.status === "handled" ? "Handled" : "Dismissed"}</Row>
              <Row label="When">
                <span className="tnum">{clockRange(inc.start, inc.end, tz)}</span>
              </Row>
              <Row label="Cameras">{inc.cameras.map((c) => c.name).join(", ")}</Row>
              <Row label="Events">
                <span className="tnum">{inc.event_ids.length}</span>
              </Row>
              {selected?.report && (
                <Row label="AI confidence">
                  {selected.report.confidence === "high" ? "High" : selected.report.confidence === "medium" ? "Medium" : "Low"}{" "}
                  <span className="text-faint">(selected clip)</span>
                </Row>
              )}
            </dl>
          </Card>
          {selected && (
            <Card className="p-4">
              <SectionTitle>Selected clip</SectionTitle>
              <p className="text-sm font-medium">{selected.title}</p>
              <ReasonChips reasons={selected.reasons} size="sm" className="mt-2" max={8} expandable />
              {selected.report?.cant_tell.length ? (
                <p className="mt-3 text-xs text-muted">
                  <span className="font-medium text-fg">Couldn't tell:</span> {selected.report.cant_tell.join("; ")}
                </p>
              ) : null}
            </Card>
          )}
        </aside>
      </div>

      <ActionBar inc={inc} site={site} onCreateRule={() => setRuleOpen(true)} />
      <RuleDialog open={ruleOpen} onClose={() => setRuleOpen(false)} events={inc.events} tz={tz} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function ActionBar({ inc, site, onCreateRule }: { inc: IncidentDetail; site: Site; onCreateRule: () => void }) {
  const status = useSetIncidentStatus();
  const dismiss = useDismissEvents();
  const toast = useToast();
  const [more, setMore] = useState(false);
  const phone = site.guarded && site.guard_phone ? site.guard_phone : null;
  const open = inc.status === "open";

  const markHandled = () =>
    status.mutate(
      { id: inc.id, status: open ? "handled" : "open" },
      {
        onSuccess: () => toast({ text: open ? "Marked as handled" : "Reopened", tone: "ok" }),
        onError: (e) => toast({ text: (e as Error).message, tone: "error" }),
      },
    );
  const notAProblem = () =>
    dismiss.mutate(
      inc.events.map((e) => e.id),
      {
        onSuccess: () => toast({ text: "Dismissed. No rule was created, so similar events will still show.", tone: "ok" }),
        onError: (e) => toast({ text: (e as Error).message, tone: "error" }),
      },
    );

  const callGuard = phone && (
    <a href={`tel:${phone.replace(/\s/g, "")}`} className={buttonClass("danger", "md", "flex-1 md:flex-none")}>
      <Phone className="size-4" aria-hidden /> Call guard
    </a>
  );
  const evidence = (
    <a href={evidencePackUrl(inc.id)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
      <FileText className="size-4" aria-hidden /> Evidence pack
    </a>
  );
  const handled = (
    <Button variant={phone ? "secondary" : "primary"} onClick={markHandled} disabled={status.isPending} className="flex-1 md:flex-none">
      {open ? <Check className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
      {open ? "Mark handled" : "Reopen"}
    </Button>
  );
  const notProblem = (
    <Button variant="ghost" onClick={notAProblem} disabled={dismiss.isPending || inc.status === "dismissed"}>
      <ThumbsUp className="size-4" aria-hidden /> Not a problem <span className="text-faint">(just this event)</span>
    </Button>
  );
  const rule = (
    <Button variant="ghost" onClick={onCreateRule}>
      <Wand2 className="size-4" aria-hidden /> Create a rule…
    </Button>
  );

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur md:sticky md:bottom-0 md:mx-[-24px] md:mt-8 md:px-6 md:py-3"
        role="toolbar"
        aria-label="Incident actions"
      >
        {/* Desktop */}
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {callGuard}
          {evidence}
          {handled}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {notProblem}
          {rule}
        </div>
        {/* Phone */}
        <div className="flex items-center gap-2 md:hidden">
          {callGuard}
          {handled}
          <button
            onClick={() => setMore(true)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg"
            aria-label="More actions"
            aria-haspopup="dialog"
          >
            <Ellipsis className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {more && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More actions">
          <button className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 animate-slide-in space-y-1 rounded-t-2xl border-t border-line-strong bg-overlay p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-sm font-semibold">More actions</p>
              <button onClick={() => setMore(false)} className="flex size-10 items-center justify-center text-muted" aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <a href={evidencePackUrl(inc.id)} target="_blank" rel="noreferrer" className="flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] hover:bg-raised">
              <FileText className="size-5 text-muted" aria-hidden /> Evidence pack (PDF)
            </a>
            <button
              onClick={() => {
                setMore(false);
                notAProblem();
              }}
              disabled={inc.status === "dismissed"}
              className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-raised disabled:opacity-50"
            >
              <ThumbsUp className="size-5 text-muted" aria-hidden /> Not a problem <span className="text-sm text-faint">(just this event)</span>
            </button>
            <button
              onClick={() => {
                setMore(false);
                onCreateRule();
              }}
              className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-raised"
            >
              <Wand2 className="size-5 text-muted" aria-hidden /> Create a rule…
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function IncidentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 px-3 pt-6 md:px-6" aria-busy="true" aria-label="Loading incident">
      <Skeleton className="h-6 w-60" />
      <Skeleton className="h-9 w-full max-w-3xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="aspect-video" />
        <Skeleton className="aspect-video" />
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}
