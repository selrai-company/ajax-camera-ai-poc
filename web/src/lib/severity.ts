import type { Brief, Severity } from "../api/contract";

export type Tone = "red" | "amber" | "blue" | "grey" | "ok";

export const SEVERITY: Record<Severity, { label: string; tone: Tone; rank: number }> = {
  needs_look: { label: "Needs a look", tone: "red", rank: 0 },
  unconfirmed: { label: "Unconfirmed", tone: "amber", rank: 1 },
  camera_issue: { label: "Camera issue", tone: "amber", rank: 2 },
  fyi: { label: "FYI", tone: "amber", rank: 3 },
  guard: { label: "Guard patrol", tone: "blue", rank: 4 },
  ignore: { label: "Ignored", tone: "grey", rank: 5 },
};

export const BRIEF_STATUS: Record<Brief["status"], { label: string; tone: Tone }> = {
  needs_look: { label: "Needs a look", tone: "red" },
  fyi: { label: "Worth knowing", tone: "amber" },
  camera_issue: { label: "Camera issue", tone: "amber" },
  all_good: { label: "All good", tone: "ok" },
};

/** Literal class strings per tone (Tailwind needs to see them statically). */
export const TONE = {
  red: {
    text: "text-sev-red-fg",
    solid: "bg-sev-red",
    soft: "bg-sev-red/12",
    border: "border-sev-red/45",
    ring: "ring-sev-red",
    dot: "bg-sev-red",
    stroke: "var(--c-red)",
  },
  amber: {
    text: "text-sev-amber-fg",
    solid: "bg-sev-amber",
    soft: "bg-sev-amber/12",
    border: "border-sev-amber/45",
    ring: "ring-sev-amber",
    dot: "bg-sev-amber",
    stroke: "var(--c-amber)",
  },
  blue: {
    text: "text-sev-blue-fg",
    solid: "bg-sev-blue",
    soft: "bg-sev-blue/12",
    border: "border-sev-blue/45",
    ring: "ring-sev-blue",
    dot: "bg-sev-blue",
    stroke: "var(--c-blue)",
  },
  grey: {
    text: "text-sev-grey-fg",
    solid: "bg-sev-grey",
    soft: "bg-sev-grey/12",
    border: "border-sev-grey/40",
    ring: "ring-sev-grey",
    dot: "bg-sev-grey",
    stroke: "var(--c-grey)",
  },
  ok: {
    text: "text-ok-fg",
    solid: "bg-ok",
    soft: "bg-ok/12",
    border: "border-ok/40",
    ring: "ring-ok",
    dot: "bg-ok",
    stroke: "var(--c-ok)",
  },
} as const;

export const toneOf = (s: Severity) => TONE[SEVERITY[s].tone];
