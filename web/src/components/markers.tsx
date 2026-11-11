import clsx from "clsx";
import { Scale, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Reason, Source } from "../api/contract";

/** The one AI marker: used wherever text was written by the AI. */
export function AiMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center gap-1 align-middle text-[11px] font-semibold tracking-wide text-ai", className)}
      title="Written by AI from the camera frames"
      aria-label="Written by AI"
      role="img"
    >
      <Sparkles className="size-3" aria-hidden />
      {!compact && <span aria-hidden>AI</span>}
    </span>
  );
}

/** Neutral marker for things decided by plain site rules. */
export function RuleMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center gap-1 align-middle text-[11px] font-semibold tracking-wide text-faint", className)}
      title="Decided by a site rule"
      aria-label="Site rule"
      role="img"
    >
      <Scale className="size-3" aria-hidden />
      {!compact && <span aria-hidden>Rule</span>}
    </span>
  );
}

export const SourceMark = ({ source, compact, className }: { source: Source; compact?: boolean; className?: string }) =>
  source === "ai" ? <AiMark compact={compact} className={className} /> : <RuleMark compact={compact} className={className} />;

export function ReasonChip({ reason, size = "md" }: { reason: Reason; size?: "sm" | "md" }) {
  const ai = reason.source === "ai";
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
        ai ? "border-ai/30 bg-ai/8 text-fg" : "border-line-strong bg-raised text-fg",
      )}
    >
      {ai ? <Sparkles className="size-3 shrink-0 text-ai" aria-hidden /> : <Scale className="size-3 shrink-0 text-faint" aria-hidden />}
      <span className="truncate">{reason.label}</span>
      <span className="sr-only">{ai ? "(from the AI description)" : "(from a site rule)"}</span>
    </span>
  );
}

export function ReasonChips({
  reasons,
  max,
  size,
  className,
  expandable,
}: {
  reasons: Reason[];
  max?: number;
  size?: "sm" | "md";
  className?: string;
  /** Show a button that reveals the rest instead of a plain "+N more". */
  expandable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = max && !open ? reasons.slice(0, max) : reasons;
  const more = reasons.length - shown.length;
  return (
    <div className={clsx("flex flex-wrap gap-1.5", className)}>
      {shown.map((r) => (
        <ReasonChip key={`${r.source}-${r.label}`} reason={r} size={size} />
      ))}
      {more > 0 &&
        (expandable ? (
          <button
            onClick={() => setOpen(true)}
            className={clsx("inline-flex items-center rounded-md px-2 text-faint hover:bg-raised hover:text-fg", size === "sm" ? "h-6 text-xs" : "h-7 text-[13px]")}
          >
            +{more} more
          </button>
        ) : (
          <span className="inline-flex h-6 items-center px-1 text-xs text-faint">+{more} more</span>
        ))}
    </div>
  );
}

export function SourceLegend({ className }: { className?: string }) {
  return (
    <p className={clsx("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint", className)}>
      <span className="inline-flex items-center gap-1.5">
        <AiMark compact /> AI describes what it sees
      </span>
      <span className="inline-flex items-center gap-1.5">
        <RuleMark compact /> Site rules decide what matters
      </span>
    </p>
  );
}
