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
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone} role="status">
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
