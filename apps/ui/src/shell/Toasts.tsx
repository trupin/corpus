import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import "./Toasts.css";

/**
 * The shared toast surface: bottom-right, at most three, six seconds
 * (`design/index.html`'s `.toast-wrap`/`.toast`).
 *
 * **Minimal on purpose.** UI-011 owns the console drawer and takes this over;
 * until then it exists because the acts the board performs are real, committed
 * writes to the workspace — pinning a list creates a document, a reorder
 * rewrites `order` in several — and a mutation that changes files on disk
 * without saying so is the one interaction that must never be silent.
 *
 * **One live region, announced once.** The wrapper is the live region — it is
 * the node that persists while toasts come and go, which is the only
 * arrangement assistive tech reliably announces. The toasts inside it are plain
 * elements: giving each one `role="status"` too (an implicit
 * `aria-live="polite"`) nested a live region inside a live region, and a nested
 * live region is announced by its own region *and* by its ancestor — the same
 * notice, read twice. That was the one real duplication behind sprint-010's
 * FIND-4. The two *DOM* nodes the finding counted are `.toast-wrap` and its
 * single `.toast` child, which a `[class*="toast"]` probe matches both of, and
 * whose text is identical whenever exactly one toast is up.
 */

export type ToastTone = "info" | "error";

export interface ToastNotice {
  readonly tone: ToastTone;
  readonly message: string;
}

interface ActiveToast extends ToastNotice {
  readonly id: number;
}

/** The prototype's cap and dwell. */
export const MAX_TOASTS = 3;
export const TOAST_DURATION_MS = 6000;

type Notify = (notice: ToastNotice) => void;

const noop: Notify = () => undefined;

const ToastContext = createContext<Notify>(noop);

/**
 * Pushes a toast. Outside a provider this is a no-op rather than a throw: a
 * plugin's row rendered in isolation should not crash for narrating itself.
 */
export function useToast(): Notify {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { readonly children?: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<readonly ActiveToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (notice) => {
      const id = nextId.current++;
      // Newest first, and the oldest falls off the end — the prototype trims the
      // wrapper's children to three.
      setToasts((current) => [{ ...notice, id }, ...current].slice(0, MAX_TOASTS));
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, TOAST_DURATION_MS);
      timers.current.add(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* `aria-live` and no `role`: the console strip's "server unreachable"
          is the surface that genuinely *is* a `role="status"`, and two of them
          would leave "the status" ambiguous. `aria-atomic="false"` keeps a new
          toast announced on its own rather than re-reading the whole stack. */}
      <div className="toast-wrap" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <span className="tick" aria-hidden="true">
              {toast.tone === "error" ? "!" : "✓"}
            </span>
            <span>{toast.message}</span>
            <button
              type="button"
              className="close"
              aria-label="Dismiss"
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
