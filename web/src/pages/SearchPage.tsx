import clsx from "clsx";
import { ArrowRight, Check, CircleHelp, Loader2, Search, ShieldQuestion, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { SearchResponse, SearchResult, Site } from "../api/contract";
import { useSearch, useWall } from "../api/hooks";
import { eventHref } from "../components/domain";
import { AiMark } from "../components/markers";
import { EventFrame } from "../components/media";
import { Button, EmptyState, ErrorState, SeverityPill } from "../components/ui";
import { useSite } from "../lib/site";
import { clock, nightDay } from "../lib/time";

const EXAMPLES = [
  "When did the delivery truck arrive?",
  "People near the container after 10pm",
  "Was anyone on site after midnight?",
  "Show vehicles at the gate",
];

const STEPS = ["Understanding your question", "Searching recorded events", "Checking frames"];

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q")?.trim() ?? "";
  const { site, night } = useSite();
  const [draft, setDraft] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const search = useSearch(site?.id, night ?? null, q);
  const wall = useWall(site?.id, night);
  const cameraNames = Object.fromEntries((wall.data?.cameras ?? []).map((c) => [c.id, c.name]));

  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (!q) input.current?.focus();
  }, [q]);

  const run = (text: string) => {
    const v = text.trim();
    if (v) navigate(`/search?q=${encodeURIComponent(v)}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(draft);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-5 md:px-6 md:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Search footage</h1>
      <p className="mt-1 text-sm text-muted">
        Ask in plain English. {site && night ? `Searching ${site.name}, ${nightDay(night)} night.` : ""}
      </p>

      <form role="search" onSubmit={submit} className="mt-5 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. When did the excavator leave?"
            aria-label="Your question"
            className="h-12 w-full rounded-xl border border-line-strong bg-surface pr-10 pl-12 text-[15px] text-fg placeholder:text-faint focus:outline-none focus-visible:outline-2 focus-visible:outline-focus"
          />
          {draft && (
            <button type="button" onClick={() => setDraft("")} className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-faint hover:text-fg" aria-label="Clear">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={!draft.trim()}>
          Search
        </Button>
      </form>

      <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Example questions">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => run(ex)}
            className={clsx(
              "h-8 shrink-0 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors",
              q === ex ? "border-fg/60 bg-raised text-fg" : "border-line bg-surface text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-8" aria-live="polite">
        {!q ? (
          <Limits />
        ) : search.isFetching && !search.data ? (
          <Progress key={q} />
        ) : search.error ? (
          <ErrorState error={search.error} onRetry={() => search.refetch()} />
        ) : search.data && site ? (
          <Results data={search.data} site={site} onRequery={run} refreshing={search.isFetching} cameraNames={cameraNames} />
        ) : null}
      </div>
    </div>
  );
}

function Progress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStep(1), 800);
    const b = setTimeout(() => setStep(2), 1700);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div className="card p-5" role="status">
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s} className={clsx("flex items-center gap-3 text-sm", i > step ? "text-faint" : "text-fg")}>
            <span className="flex size-5 items-center justify-center">
              {i < step ? (
                <Check className="size-4 text-ok" aria-hidden />
              ) : i === step ? (
                <Loader2 className="size-4 animate-spin text-fg" aria-hidden />
              ) : (
                <span className="size-1.5 rounded-full bg-line-strong" aria-hidden />
              )}
            </span>
            {s}
            {i === step && <span className="sr-only">(in progress)</span>}
          </li>
        ))}
      </ol>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
    </div>
  );
}

function composeQuery(i: SearchResponse["interpreted"], tz: string, drop: { kind: string; value: string }): string {
  const words: string[] = [];
  const subj = i.subjects.filter((s) => !(drop.kind === "subject" && drop.value === s));
  words.push(...subj.map((s) => (s === "person" ? "people" : s === "vehicle" ? "vehicles" : s === "animal" ? "animals" : s)));
  words.push(...i.keywords.filter((k) => !(drop.kind === "keyword" && drop.value === k)));
  const cams = i.cameras.filter((c) => !(drop.kind === "camera" && drop.value === c));
  if (cams.length) words.push(`on ${cams.join(" and ")}`);
  if (i.start && drop.kind !== "start") words.push(`after ${clock(i.start, tz)}`);
  if (i.end && drop.kind !== "end") words.push(`before ${clock(i.end, tz)}`);
  return words.join(" ").trim() || "anything";
}

function Results({ data, site, onRequery, refreshing, cameraNames }: { data: SearchResponse; site: Site; onRequery: (q: string) => void; refreshing: boolean; cameraNames: Record<string, string> }) {
  const tz = site.timezone;
  const [flash, setFlash] = useState<number | null>(null);
  const it = data.interpreted;
  const [allWords, setAllWords] = useState(false);
  const camName = (c: string) => cameraNames[c] ?? c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
  const timeLabel = (iso: string) => {
    const c = clock(iso, tz);
    return c === "12:00am" ? "midnight" : c === "12:00pm" ? "midday" : c;
  };
  const words = allWords ? it.keywords : it.keywords.slice(0, 4);
  const chips: { kind: string; value: string; label: string }[] = [
    ...it.subjects.map((s) => ({ kind: "subject", value: s, label: s === "person" ? "People" : s === "vehicle" ? "Vehicles" : s === "animal" ? "Animals" : s.charAt(0).toUpperCase() + s.slice(1) })),
    ...it.cameras.map((c) => ({ kind: "camera", value: c, label: `Camera: ${camName(c)}` })),
    ...(it.start ? [{ kind: "start", value: it.start, label: `After ${timeLabel(it.start)}` }] : []),
    ...(it.end ? [{ kind: "end", value: it.end, label: `Before ${timeLabel(it.end)}` }] : []),
    ...words.map((k) => ({ kind: "keyword", value: k, label: `“${k}”` })),
  ];
  const hiddenWords = it.keywords.length - words.length;

  const cite = (id: number) => {
    const el = document.getElementById(`result-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    setTimeout(() => setFlash(null), 1500);
    (el.querySelector("a") as HTMLElement | null)?.focus({ preventScroll: true });
  };

  return (
    <div className={clsx("space-y-6 transition-opacity", refreshing && "opacity-60")}>
      {/* Interpreted filters */}
      <section aria-label="How the question was understood">
        <p className="mb-2 text-xs text-faint">
          Understood as: <span className="text-muted">{it.summary}</span> <AiMark compact />
        </p>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={`${c.kind}-${c.value}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-raised pr-1 pl-2.5 text-[13px]">
              {c.label}
              {chips.length > 1 && (
                <button
                  onClick={() => onRequery(composeQuery(it, tz, c))}
                  className="flex size-5 items-center justify-center rounded text-faint hover:bg-overlay hover:text-fg"
                  aria-label={`Remove ${c.label} and search again`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {hiddenWords > 0 && (
            <button onClick={() => setAllWords(true)} className="inline-flex h-7 items-center rounded-md px-2 text-[13px] text-faint hover:bg-raised hover:text-fg">
              +{hiddenWords} more words
            </button>
          )}
        </div>
      </section>

      {/* Answer */}
      {data.answer ? (
        <section className="card border-ai/25 p-5" aria-label="Answer">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <AiMark /> Answer from recorded events
          </p>
          <p className="text-[16px] leading-relaxed text-fg md:text-[17px]">
            <Cited text={data.answer} onCite={cite} />
          </p>
        </section>
      ) : null}

      {/* Results */}
      {data.results.length === 0 ? (
        <EmptyState icon={<CircleHelp className="size-5" />} title="No matching recorded events">
          That doesn't mean nothing happened. The search only covers moments the motion detector caught and the AI described. Try fewer words, or a different camera or time.
        </EmptyState>
      ) : (
        <section aria-label="Matching events">
          <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-muted">
            {data.results.length} matching moment{data.results.length === 1 ? "" : "s"}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.results.map((r) => (
              <ResultCard key={r.event.id} r={r} tz={tz} flash={flash === r.event.id} />
            ))}
          </ul>
        </section>
      )}

      <Limits note={data.note} />
    </div>
  );
}

function Cited({ text, onCite }: { text: string; onCite: (id: number) => void }) {
  const parts = text.split(/(\[#\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[#(\d+)\]$/);
        if (!m) return <Fragment key={i}>{p}</Fragment>;
        const id = Number(m[1]);
        return (
          <button
            key={i}
            onClick={() => onCite(id)}
            className="tnum mx-0.5 inline-flex h-5 items-center rounded bg-raised px-1.5 align-[0.1em] text-[11px] font-semibold text-muted ring-1 ring-line-strong hover:text-fg"
            aria-label={`Show event ${id}`}
          >
            #{id}
          </button>
        );
      })}
    </>
  );
}

function highlight(text: string, words: string[]): ReactNode {
  const ws = words.filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ws.length) return text;
  const re = new RegExp(`(${ws.join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

function ResultCard({ r, tz, flash }: { r: SearchResult; tz: string; flash: boolean }) {
  const e = r.event;
  return (
    <li id={`result-${e.id}`} className={clsx("rounded-[var(--radius-card)]", flash && "animate-flash")}>
      <Link to={eventHref(e)} className="card group flex h-full flex-col overflow-hidden transition-colors hover:border-line-strong hover:bg-raised">
        <EventFrame event={e} className="aspect-video w-full rounded-none" />
        <div className="flex flex-1 flex-col p-3.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="tnum text-xs font-semibold text-fg">{clock(e.start, tz)}</span>
            <span className="text-xs text-muted">{e.camera_name}</span>
            <span className="tnum text-xs text-faint">#{e.id}</span>
            {e.severity !== "ignore" && <SeverityPill severity={e.severity} size="sm" className="ml-auto" />}
          </div>
          <p className="text-sm font-medium text-fg">{highlight(e.title, r.highlights)}</p>
          {e.report && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{highlight(e.report.summary, r.highlights)}</p>}
          <p className="mt-2 text-xs text-faint">{r.why.replace(/^Matches:/, "Matches because:")}</p>
          <div className="mt-auto flex items-center justify-between pt-3">
            {r.checked_on_frames ? (
              r.frame_check === "confirmed" ? (
                <span className="inline-flex items-center gap-1 text-xs text-ok-fg">
                  <Check className="size-3.5" aria-hidden /> Checked on frames
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-sev-amber-fg">
                  <ShieldQuestion className="size-3.5" aria-hidden /> Not confirmed on frames
                </span>
              )
            ) : (
              <span />
            )}
            <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
        </div>
      </Link>
    </li>
  );
}

function Limits({ note }: { note?: string | null }) {
  return (
    <aside className="rounded-xl border border-line bg-surface/60 p-4 text-[13px] text-muted">
      <p className="mb-1.5 font-medium text-fg">What search can and can't do</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>It only finds moments the motion detector caught and the AI described.</li>
        <li>It searches descriptions, then re-checks the top results against the frames.</li>
        <li>This system doesn't identify people.</li>
      </ul>
      {note && !note.startsWith("This system doesn't identify people") && <p className="mt-2">{note}</p>}
    </aside>
  );
}
