import clsx from "clsx";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Severity } from "../api/contract";
import { SEVERITY, TONE, type Tone } from "../lib/severity";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-fg text-canvas hover:bg-white font-semibold",
  secondary: "bg-raised text-fg border border-line-strong hover:bg-overlay",
  ghost: "text-muted hover:text-fg hover:bg-raised",
  danger: "bg-sev-red text-white hover:brightness-110 font-semibold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }>(
  function Button({ variant = "secondary", size = "md", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap transition-colors disabled:opacity-50",
          size === "sm" && "h-8 px-3 text-[13px]",
          size === "md" && "h-10 px-4 text-sm",
          size === "lg" && "h-12 px-5 text-[15px]",
          variants[variant],
          className,
        )}
        {...rest}
      />
    );
  },
);

export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" | "lg" = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap transition-colors",
    size === "sm" && "h-8 px-3 text-[13px]",
    size === "md" && "h-10 px-4 text-sm",
    size === "lg" && "h-12 px-5 text-[15px]",
    variants[variant],
    extra,
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SeverityPill({ severity, className, size = "md" }: { severity: Severity; className?: string; size?: "sm" | "md" }) {
  const s = SEVERITY[severity];
  return <TonePill tone={s.tone} className={className} size={size}>{s.label}</TonePill>;
}

export function TonePill({ tone, children, className, size = "md" }: { tone: Tone; children: ReactNode; className?: string; size?: "sm" | "md" }) {
  const t = TONE[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        t.soft,
        t.border,
        t.text,
        className,
      )}
    >
      <span className={clsx("size-1.5 rounded-full", t.dot)} aria-hidden />
      {children}
    </span>
  );
}

export function Dot({ tone, className, pulse }: { tone: Tone; className?: string; pulse?: boolean }) {
  return <span aria-hidden className={clsx("inline-block size-2 shrink-0 rounded-full", TONE[tone].dot, pulse && "animate-pulse", className)} />;
}

export function Card({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" }) {
  return <As className={clsx("card", className)}>{children}</As>;
}

export function SectionTitle({ children, action, className, id }: { children: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={clsx("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 id={id} className="text-[13px] font-semibold tracking-wide text-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-raised text-muted">{icon}</div>}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className={clsx("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-raised text-sev-amber">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-[15px] font-semibold">Couldn't load this</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{msg}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-raised px-1 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx("flex gap-1 overflow-x-auto border-b border-line scrollbar-none", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value);
            if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
            if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
          }}
          tabIndex={value === t.id ? 0 : -1}
          className={clsx(
            "relative -mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
            value === t.id ? "border-fg font-semibold text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count != null && (
            <span className={clsx("tnum rounded-full px-1.5 text-[11px] leading-5", value === t.id ? "bg-fg text-canvas" : "bg-raised text-muted")}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-fg md:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
