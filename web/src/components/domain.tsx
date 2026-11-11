import clsx from "clsx";
import { ArrowRight, Bell, Car, CircleCheck, CircleHelp, CircleX, PackageCheck, PackageX, Siren, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AssetCheck, CameraEvent, Incident, LockupCheck, RepeatVehicle, RuleSuggestion, Site } from "../api/contract";
import { useCreateRule } from "../api/hooks";
import { SEVERITY, toneOf } from "../lib/severity";
import { clock, clockRange, nightDay } from "../lib/time";
import { useToast } from "../lib/toast";
import { AiMark, ReasonChips, SourceMark } from "./markers";
import { EventFrame, Frame } from "./media";
import { boxForFrame } from "../lib/track";
import { Button, Dot, SeverityPill, TonePill } from "./ui";

export const eventHref = (e: Pick<CameraEvent, "incident_id" | "camera_id" | "start" | "site_id">) =>
  e.incident_id != null
    ? `/incidents/${e.incident_id}`
    : `/cameras/${e.camera_id}?site=${encodeURIComponent(e.site_id)}&t=${encodeURIComponent(e.start)}`;

export const incidentHref = (i: Pick<Incident, "id">) => `/incidents/${i.id}`;

const STATUS_LABEL: Record<Incident["status"], string> = { open: "Open", handled: "Handled", dismissed: "Dismissed" };

/** Red/amber incident card for the AI rail, brief and lists. */
export function IncidentCard({
  incident,
  tz,
  variant = "rail",
  fresh,
  keyEvent,
}: {
  incident: Incident;
  tz: string;
  variant?: "rail" | "list" | "brief";
  fresh?: boolean;
  /** The event the key frame came from, to draw its motion box. */
  keyEvent?: CameraEvent;
}) {
  const tone = toneOf(incident.severity);
  const closed = incident.status !== "open";
  const stacked = variant === "brief" || variant === "rail";
  const box = keyEvent ? boxForFrame(keyEvent, incident.key_frame) : null;
  return (
    <Link
      to={incidentHref(incident)}
      className={clsx(
        "group block overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-colors hover:bg-raised",
        closed ? "border-line" : tone.border,
        fresh && "animate-slide-in",
      )}
      aria-label={`${SEVERITY[incident.severity].label}: ${incident.headline}`}
    >
      <div className={clsx("flex gap-3", stacked ? "flex-col gap-0" : "p-3 md:p-4")}>
        <Frame
          src={incident.key_frame}
          alt=""
          box={box}
          boxSeverity={incident.severity}
          className={clsx(
            "shrink-0",
            stacked ? "aspect-video w-full rounded-none" : "aspect-video w-32 self-start md:w-44",
            closed && "opacity-70",
          )}
        >
          {incident.alarm && (
            <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
              <Siren className="size-3 text-sev-red" aria-hidden /> Alarm
            </span>
          )}
        </Frame>
        <div className={clsx("min-w-0 flex-1", variant === "brief" && "px-4 pt-3 pb-4", variant === "rail" && "px-3 pt-2.5 pb-3")}>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <SeverityPill severity={incident.severity} size="sm" />
            <span className="tnum text-xs text-muted">{clockRange(incident.start, incident.end, tz)}</span>
            {closed && <span className="text-xs text-faint">· {STATUS_LABEL[incident.status]}</span>}
          </div>
          <p className={clsx("leading-snug text-fg", variant === "rail" ? "line-clamp-3 text-[13px]" : "text-[15px]")}>
            {incident.headline} {incident.headline_by === "ai" && <AiMark compact className="ml-0.5" />}
          </p>
          {variant !== "rail" && <p className="mt-1.5 truncate text-xs text-faint">{incident.cameras.map((c) => c.name).join(" → ")}</p>}
          <ReasonChips reasons={incident.why} max={variant === "rail" ? 4 : 5} size="sm" className="mt-2" />
        </div>
      </div>
    </Link>
  );
}

/** One line in the AI feed: time, camera, what happened. Ignored ones are greyed with the reason. */
export function EventRow({ event, tz, fresh, showCamera = true }: { event: CameraEvent; tz: string; fresh?: boolean; showCamera?: boolean }) {
  const tone = toneOf(event.severity);
  const ignored = event.severity === "ignore" || event.dismissed;
  const reason = ignored
    ? event.dismissed
      ? "Dismissed by you"
      : (event.reasons.find((r) => r.source === "rule")?.label ?? event.reasons[0]?.label)
    : null;
  return (
    <li className={clsx(fresh && "animate-fade-in")}>
      <Link to={eventHref(event)} className={clsx("flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-raised", ignored && "opacity-70")}>
        <span className="tnum w-[52px] shrink-0 pt-px text-xs text-muted">{clock(event.start, tz)}</span>
        <Dot tone={SEVERITY[event.severity].tone} className="mt-1.5" />
        <span className="min-w-0 flex-1">
          <span className={clsx("block text-[13px] leading-snug", ignored ? "text-muted" : "text-fg")}>
            {event.title}
            {event.report && <AiMark compact className="ml-1" />}
          </span>
          <span className="mt-0.5 block truncate text-xs text-faint">
            {showCamera && event.camera_name}
            {showCamera && (reason || !ignored) && " · "}
            {reason ? `Ignored: ${reason.replace(/^Matched your rule: /, "matched rule, ")}` : <span className={tone.text}>{SEVERITY[event.severity].label}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Lock-up check list: works for 1–6 questions. */
export function LockupList({ checks, tz, compact }: { checks: LockupCheck[]; tz: string; compact?: boolean }) {
  if (!checks.length) return <p className="text-sm text-muted">No lock-up check configured for this site.</p>;
  return (
    <ul className={clsx("grid gap-2", !compact && "sm:grid-cols-2")}>
      {checks.map((c) => {
        const Icon = c.ok ? CircleCheck : c.answer === "cant_tell" ? CircleHelp : CircleX;
        return (
          <li key={`${c.camera_id}-${c.question}`} className="flex gap-3 rounded-xl border border-line bg-canvas/40 p-2.5">
            {!compact && <Frame src={c.image} alt={`${c.camera_name} at lock-up`} className="aspect-video w-20 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="flex items-start gap-1.5 text-[13px] font-medium text-fg">
                <Icon className={clsx("mt-px size-4 shrink-0", c.ok ? "text-ok" : c.answer === "cant_tell" ? "text-sev-amber" : "text-sev-red")} aria-hidden />
                <span>
                  {c.question}{" "}
                  <span className={clsx("font-semibold", c.ok ? "text-ok-fg" : "text-sev-red-fg")}>
                    {c.answer === "yes" ? "Yes" : c.answer === "no" ? "No" : "Can't tell"}
                  </span>
                </span>
              </p>
              {!compact && (
                <p className="mt-1 text-xs text-muted">
                  {c.why} <AiMark compact />
                </p>
              )}
              <p className="tnum mt-0.5 text-[11px] text-faint">
                {c.camera_name} · {clock(c.at, tz)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function lockupSummary(checks: LockupCheck[]): { text: string; ok: boolean } {
  if (!checks.length) return { text: "No lock-up check", ok: true };
  const bad = checks.filter((c) => !c.ok);
  return bad.length ? { text: `${bad.length} of ${checks.length} not OK`, ok: false } : { text: "All closed", ok: true };
}

/** Evening vs morning: is the asset still there? Red when missing. */
export function AssetCard({ asset, tz, compact }: { asset: AssetCheck; tz: string; compact?: boolean }) {
  const missing = asset.status === "missing";
  const unclear = asset.status === "unclear";
  const Icon = missing ? PackageX : unclear ? CircleHelp : PackageCheck;
  return (
    <article
      className={clsx(
        "rounded-[var(--radius-card)] border p-3",
        missing ? "border-sev-red/50 bg-sev-red/8" : unclear ? "border-sev-amber/40 bg-surface" : "border-line bg-surface",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={clsx("mt-0.5 size-[18px] shrink-0", missing ? "text-sev-red" : unclear ? "text-sev-amber" : "text-ok")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
            {asset.asset}
            {missing && <TonePill tone="red" size="sm">Missing</TonePill>}
            {unclear && <TonePill tone="amber" size="sm">Can't check</TonePill>}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {asset.text} <AiMark compact />
          </p>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["evening", "morning"] as const).map((k) => {
            const snap = asset[k];
            const gone = snap?.present === "no";
            return (
              <figure key={k} className="min-w-0">
                <Frame
                  src={snap?.image}
                  alt={`${asset.asset}, ${k}`}
                  className={clsx("aspect-video w-full", gone && "ring-2 ring-sev-red")}
                  fallbackText={snap ? "No image" : "Not checked"}
                >
                  {snap && (
                    <span
                      className={clsx(
                        "absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        snap.present === "yes" ? "bg-black/75 text-ok-fg" : snap.present === "no" ? "bg-sev-red text-white" : "bg-black/75 text-sev-amber-fg",
                      )}
                    >
                      {snap.present === "yes" ? "There" : snap.present === "no" ? "Not there" : "Can't tell"}
                    </span>
                  )}
                </Frame>
                <figcaption className="tnum mt-1 text-[11px] text-faint">
                  {k === "evening" ? "Lock-up" : "Morning"} {snap ? `· ${clock(snap.at, tz)}` : ""}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** Same kind of vehicle seen on several armed nights: possible casing. Vehicles only, no plates. */
export function RepeatVehicleCard({ rv, tz, compact }: { rv: RepeatVehicle; tz: string; compact?: boolean }) {
  return (
    <article className="rounded-[var(--radius-card)] border border-sev-amber/40 bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <Car className="mt-0.5 size-[18px] shrink-0 text-sev-amber" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
            {rv.text}
            <TonePill tone="amber" size="sm">Possible casing</TonePill>
          </p>
          <p className="mt-0.5 text-xs text-faint">Matched on vehicle type and colour only. Number plates aren't read.</p>
        </div>
      </div>
      {!compact && (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="Sightings">
          {rv.sightings.map((s) => (
            <li key={s.event_id} className="w-36 shrink-0">
              <Frame src={s.image} alt={`${rv.description}, ${s.camera_name}`} className="aspect-video w-full" />
              <p className="tnum mt-1 text-[11px] text-muted">
                {nightDay(s.at.slice(0, 10))} · {clock(s.at, tz)}
              </p>
              <p className="truncate text-[11px] text-faint">{s.camera_name}</p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** After 3 dismissals of the same thing: offer the rule, with its exact preview. */
export function SuggestionCard({ s, site }: { s: RuleSuggestion; site: Site }) {
  const create = useCreateRule();
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <Wand2 className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            You've dismissed '{s.activity_label.toLowerCase()}' on {s.camera_name} {s.dismissed_count} times. Create a rule?
          </p>
          <div className="mt-2 rounded-lg border border-line bg-canvas/50 p-2.5 text-[13px]">
            <p className="text-fg">{s.preview.description}</p>
            <p className="mt-1 text-xs text-muted">
              Would hide <span className="tnum font-semibold text-fg">{s.preview.would_hide}</span> past event{s.preview.would_hide === 1 ? "" : "s"} at {site.name.split(",")[0]}.
            </p>
            {s.preview.caveat && <p className="mt-1 text-xs text-faint">{s.preview.caveat}</p>}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={create.isPending || done}
              onClick={() =>
                create.mutate(s.preview.event_id, {
                  onSuccess: () => {
                    setDone(true);
                    toast({ text: "Rule created", tone: "ok", action: { label: "View rules", to: "/sites?tab=rules" } });
                  },
                  onError: (e) => toast({ text: e instanceof Error ? e.message : "Couldn't create the rule", tone: "error" }),
                })
              }
            >
              {done ? "Rule created" : create.isPending ? "Creating…" : "Create rule"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Status sentence for the top of the rail. */
export function StatusSegments({ items }: { items: { label: string; tone?: "ok" | "red" | "amber" | "blue" | "grey"; icon?: "bell" }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg">
          {it.tone ? <Dot tone={it.tone} /> : <span className="size-1.5 rounded-full bg-faint" aria-hidden />}
          {it.icon === "bell" && <Bell className="size-3" aria-hidden />}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function SeeAll({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

export function SourceLine({ source, children }: { source: "ai" | "rule"; children: ReactNode }) {
  return (
    <span>
      {children} <SourceMark source={source} compact />
    </span>
  );
}

export { EventFrame };
