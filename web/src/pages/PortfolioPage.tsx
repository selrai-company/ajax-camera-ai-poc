import clsx from "clsx";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { Link } from "react-router-dom";
import type { PortfolioSite } from "../api/contract";
import { usePortfolio } from "../api/hooks";
import { Frame } from "../components/media";
import { EmptyState, ErrorState, PageHeader, Skeleton, TonePill } from "../components/ui";
import { BRIEF_STATUS, TONE } from "../lib/severity";
import { nightDay } from "../lib/time";

export default function PortfolioPage() {
  const q = usePortfolio(null);
  const rows = q.data ?? [];
  const urgent = rows.filter((r) => r.status === "needs_look").length;
  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-5 md:px-6 md:py-8">
      <PageHeader
        title="All sites"
        subtitle={q.data ? (urgent ? `${urgent} site${urgent === 1 ? " needs" : "s need"} a look. Most urgent first.` : "Every site had a quiet night.") : "Last night across every site, most urgent first."}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No sites yet">Sites appear here once their cameras are connected.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <SiteRow key={r.site.id} r={r} rank={i + 1} />
          ))}
        </ol>
      )}
    </div>
  );
}

function SiteRow({ r, rank }: { r: PortfolioSite; rank: number }) {
  const st = BRIEF_STATUS[r.status];
  const tone = TONE[st.tone];
  const counts: { label: string; value: number | string; tone?: "red" | "amber" | "ok" }[] = [
    { label: "Open incidents", value: r.open_incidents, tone: r.open_incidents ? "red" : undefined },
    { label: "Unconfirmed", value: r.unconfirmed, tone: r.unconfirmed ? "amber" : undefined },
    ...(r.site.guarded ? [{ label: "Missed visits", value: r.missed_rounds, tone: r.missed_rounds ? ("amber" as const) : undefined }] : []),
    { label: "Camera issues", value: r.camera_issues, tone: r.camera_issues ? "amber" : undefined },
    { label: "Assets missing", value: r.assets_missing, tone: r.assets_missing ? "red" : undefined },
    { label: "Lock-up", value: r.lockup_ok == null ? "–" : r.lockup_ok ? "OK" : "Not OK", tone: r.lockup_ok == null ? undefined : r.lockup_ok ? "ok" : "red" },
  ];
  return (
    <li className={clsx("card relative overflow-hidden transition-colors hover:bg-raised", r.status === "needs_look" && "border-sev-red/45")}>
      <span className={clsx("absolute inset-y-0 left-0 w-1", tone.solid)} aria-hidden />
      <div className="flex flex-col gap-4 p-4 pl-5 md:flex-row md:items-center">
        <Link to={`/brief?site=${r.site.id}`} className="flex min-w-0 flex-1 flex-col gap-3 after:absolute after:inset-0 sm:flex-row sm:gap-4" aria-label={`${r.site.name}: open the morning brief`}>
          <Frame src={r.key_frame} alt="" className="aspect-[16/7] w-full shrink-0 self-start sm:aspect-video sm:w-28 md:w-40" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tnum text-xs text-faint">#{rank}</span>
              <h2 className="text-[15px] font-semibold">{r.site.name}</h2>
              <TonePill tone={st.tone} size="sm">
                {st.label}
              </TonePill>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-fg">{r.headline}</p>
            <p className={clsx("mt-1 text-xs", r.status === "all_good" ? "text-faint" : tone.text)}>{r.rank_reason}</p>
            <p className="mt-0.5 text-xs text-faint">
              {r.site.address_hint} · {nightDay(r.night)} night{r.site.guarded ? " · Guarded" : ""}
            </p>
          </div>
        </Link>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 md:w-[300px] md:shrink-0">
          {counts.map((c) => (
            <div key={c.label}>
              <dt className="truncate text-[11px] text-faint">{c.label}</dt>
              <dd className={clsx("tnum text-[15px] font-semibold", c.tone ? TONE[c.tone].text : "text-muted")}>{c.value}</dd>
            </div>
          ))}
        </dl>
        <div className="relative z-10 flex gap-2 md:flex-col">
          <Link to={`/wall?site=${r.site.id}`} className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 text-[13px] text-fg hover:bg-overlay" aria-label={`Open ${r.site.name} camera wall`}>
            <LayoutGrid className="size-3.5" aria-hidden /> Wall
          </Link>
          <Link to={`/brief?site=${r.site.id}`} className="flex h-9 items-center gap-1 rounded-lg px-3 text-[13px] text-muted hover:text-fg" tabIndex={-1} aria-hidden>
            Brief <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </li>
  );
}
