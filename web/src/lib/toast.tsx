import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, X } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
  action?: { label: string; to: string };
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = seq++;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => dismiss(id), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+76px)] z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-sm animate-slide-in items-center gap-3 rounded-xl border border-line-strong bg-overlay px-4 py-3 text-sm shadow-pop"
          >
            {t.tone === "ok" ? (
              <CircleCheck className="size-4 shrink-0 text-ok" aria-hidden />
            ) : (
              <CircleX className="size-4 shrink-0 text-sev-red" aria-hidden />
            )}
            <span className="text-fg">{t.text}</span>
            {t.action && (
              <Link to={t.action.to} className="font-medium whitespace-nowrap text-fg underline underline-offset-2" onClick={() => dismiss(t.id)}>
                {t.action.label}
              </Link>
            )}
            <button className={clsx("-mr-1 rounded p-1 text-faint hover:text-fg")} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
