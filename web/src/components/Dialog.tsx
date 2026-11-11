import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Modal built on <dialog>: focus trap, Esc to close and backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(560px,calc(100vw-24px))] max-w-none rounded-2xl border border-line-strong bg-overlay p-0 text-fg shadow-pop backdrop:bg-black/65 backdrop:backdrop-blur-[2px] open:animate-slide-in max-md:mb-3 max-md:w-[calc(100vw-16px)]"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
            <div>
              <h2 id="dialog-title" className="text-[17px] font-semibold">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-muted">{description}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
