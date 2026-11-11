import clsx from "clsx";
import { EyeOff, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { CameraEvent } from "../api/contract";
import { useCreateRule, useRulePreview } from "../api/hooks";
import { clock } from "../lib/time";
import { useToast } from "../lib/toast";
import { Dialog } from "./Dialog";
import { Button, Skeleton } from "./ui";

/** "Create a rule…": shows the exact recurring rule and how much past history it would hide before saving. */
export function RuleDialog({ open, onClose, events, tz }: { open: boolean; onClose: () => void; events: CameraEvent[]; tz: string }) {
  const [eventId, setEventId] = useState<number | null>(events[0]?.id ?? null);
  useEffect(() => {
    if (open) setEventId(events[0]?.id ?? null);
  }, [open, events]);
  const preview = useRulePreview(open ? eventId : null);
  const create = useCreateRule();
  const toast = useToast();
  const p = preview.data;

  const save = () => {
    if (eventId == null) return;
    create.mutate(eventId, {
      onSuccess: () => {
        toast({ text: "Rule saved. Matching events will be ignored from now on.", tone: "ok", action: { label: "View rules", to: "/sites?tab=rules" } });
        onClose();
      },
      onError: (e) => toast({ text: e instanceof Error ? e.message : "Couldn't save the rule", tone: "error" }),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a rule"
      description="A rule hides this kind of event every night from now on. Check exactly what it will do first."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!p || create.isPending}>
            {create.isPending ? "Saving…" : "Save rule"}
          </Button>
        </>
      }
    >
      {events.length > 1 && (
        <fieldset className="mb-4">
          <legend className="mb-2 text-[13px] font-medium text-muted">Base the rule on</legend>
          <div className="space-y-1.5">
            {events.map((e) => (
              <label
                key={e.id}
                className={clsx(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                  eventId === e.id ? "border-line-strong bg-raised" : "border-line hover:bg-raised/60",
                )}
              >
                <input type="radio" name="rule-event" checked={eventId === e.id} onChange={() => setEventId(e.id)} className="accent-[var(--c-fg)]" />
                <span className="tnum w-14 text-xs text-muted">{clock(e.start, tz)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.camera_name}: {e.report?.activity_label ?? e.title}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {preview.isLoading || !p ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-10" />
        </div>
      ) : preview.error ? (
        <p className="text-sm text-sev-red-fg">Couldn't preview this rule. {String((preview.error as Error).message)}</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-line-strong bg-canvas/60 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">The rule</p>
            <p className="mt-1 text-[15px] leading-snug text-fg">{p.description}</p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <EyeOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <p className="text-sm text-muted">
              {p.would_hide > 0 ? (
                <>
                  It would have hidden <span className="tnum font-semibold text-fg">{p.would_hide}</span> past event{p.would_hide === 1 ? "" : "s"} in the stored history.
                </>
              ) : (
                <>It wouldn't have hidden any past events.</>
              )}
            </p>
          </div>
          {p.caveat && (
            <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-sm text-muted">{p.caveat}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
