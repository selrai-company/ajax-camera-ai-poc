import clsx from "clsx";
import { Building2, Check, ChevronDown, Shield, ShieldOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReplay } from "../lib/replay";
import { useSite } from "../lib/site";
import { guardOnShift, isArmed } from "../lib/status";

export function SiteSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { sites, site, setSite, isLoading } = useSite();
  const { t, ready } = useReplay();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const now = ready ? t : Date.now();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isLoading || !site) {
    return <div className={clsx("skeleton h-14", className)} aria-label="Loading sites" />;
  }
  const armed = isArmed(site, now);
  const guard = guardOnShift(site, now);

  return (
    <div ref={wrap} className={clsx("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "flex w-full items-center gap-3 rounded-xl border border-line bg-raised text-left transition-colors hover:border-line-strong",
          compact ? "h-11 px-2.5" : "px-3 py-2.5",
        )}
      >
        <span className={clsx("size-8 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted", compact ? "flex" : "hidden")}>
          <Building2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx("block text-sm leading-tight font-semibold text-fg", compact ? "truncate" : "line-clamp-2")}>{site.name}</span>
          {!compact && (
            <span className="mt-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
              {armed ? <Shield className="size-3 text-fg" aria-hidden /> : <ShieldOff className="size-3" aria-hidden />}
              {armed ? "Armed" : "Disarmed"}
              {site.guarded && (
                <>
                  <span aria-hidden className="text-faint">·</span>
                  {guard ? "Guard on shift" : "No guard now"}
                </>
              )}
            </span>
          )}
        </span>
        <ChevronDown className={clsx("size-4 shrink-0 text-faint transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Choose a site"
          className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[60vh] min-w-[260px] animate-fade-in overflow-y-auto rounded-xl border border-line-strong bg-overlay p-1.5 shadow-pop"
        >
          {sites.map((s) => (
            <li key={s.id}>
              <button
                role="option"
                aria-selected={s.id === site.id}
                onClick={() => {
                  setSite(s.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{s.name}</span>
                  <span className="block text-xs text-faint">
                    {s.address_hint ?? s.timezone}
                    {s.guarded ? " · Guarded" : ""}
                  </span>
                </span>
                {s.id === site.id && <Check className="size-4 text-fg" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
