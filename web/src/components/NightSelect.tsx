import { CalendarDays } from "lucide-react";
import { useSite } from "../lib/site";
import { nightLabel } from "../lib/time";

export function NightSelect({ className }: { className?: string }) {
  const { site, night, setNight } = useSite();
  if (!site || !night) return null;
  return (
    <label className={`relative inline-flex items-center ${className ?? ""}`}>
      <span className="sr-only">Night</span>
      <CalendarDays className="pointer-events-none absolute left-2.5 size-4 text-faint" aria-hidden />
      <select
        value={night}
        onChange={(e) => setNight(e.target.value)}
        className="h-9 appearance-none rounded-lg border border-line bg-raised pr-8 pl-8 text-sm text-fg hover:border-line-strong"
      >
        {site.nights.map((n, i) => (
          <option key={n} value={n}>
            {i === 0 ? `Last night · ${nightLabel(n).replace(" night", "")}` : nightLabel(n)}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 size-3.5 text-faint" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    </label>
  );
}
