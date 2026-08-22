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
 *
 * **Nothing in the stack moves** (SPEC.md §10's rider, signed 2026-08-20; the
 * defect is UI-132). The wrapper used to be a bottom-anchored flow with the
 * newest toast first, so the oldest — the one whose six seconds runs out first
 * — was the bottom child, and its departure dropped every survivor 47px toward
 * the anchor, straight through the `✕` a person was reaching for. The stack is
 * now {@link MAX_TOASTS} **reserved slots** of one fixed height: a toast is
 * given a slot when it arrives, keeps it until it goes, and no arrival or
 * departure ever re-slots another toast. See `Toasts.css` for the geometry.
 *
 * The slot answers "does not move". "Does not vanish under you" is the other
 * half, and it is {@link ToastProvider}'s `pointed`/`focused` refs: the dwell
 * still elapses on time, but a toast the pointer is on or the focus is in is
 * marked overdue instead of dropped, and goes the instant the person leaves it.
 * That cannot grow a wall — the cap is still three, and a notice arriving at a
 * full stack takes the slot of the oldest toast **nobody is touching**. At most
 * one toast is under the pointer and at most one holds focus, so with three
 * slots there is always one to take.
 *
 * **A toast is a notice arriving, and the arrival is not the record**
 * (SPEC.md §10's Notices paragraph, rider authorized 2026-08-21; UI-139). The
 * provider therefore keeps a second, longer-lived thing beside the stack: the
 * session's {@link NoticeLog}, which the console's Notices tab reads. It is a
 * *sibling* of the toast array rather than a view of it — a toast is gone six
 * seconds after it arrives and the notice is not — and it is fed from the one
 * place a toast is fed from, {@link ToastProvider}'s `notify`. Every toast
 * becomes a notice and nothing else may make one: two entry points is how the
 * two lists come to disagree about what the session raised.
 *
 * Nothing about a notice reaches disk. The log is browser state, session-scoped
 * by construction — it lives in this component's `useState` — so a reload
 * clears it, which the rider states as the accepted cost of a record that needs
 * no server.
 */

export type ToastTone = "info" | "error";

export interface ToastNotice {
  readonly tone: ToastTone;
  readonly message: string;
}

interface ActiveToast extends ToastNotice {
  readonly id: number;
  /**
   * The reserved slot this toast occupies for its whole life. `0` sits against
   * the anchor at the bottom-right corner and the stack grows upward, so a
   * lone toast lands exactly where the prototype puts it.
   */
  readonly slot: number;
}

/** The prototype's cap and dwell. */
export const MAX_TOASTS = 3;
export const TOAST_DURATION_MS = 6000;

/**
 * One entry of the session's notice log: a toast that arrived, kept after it
 * went. `id` is the toast's own id — they are the same event read twice — and
 * `at` is the wall-clock instant it was raised, which is the "when" the Notices
 * tab shows.
 */
export interface Notice extends ToastNotice {
  readonly id: number;
  readonly at: number;
}

/**
 * How many notices the session keeps.
 *
 * The list is bounded because it is unbounded browser state fed by a server
 * that can refuse as often as it likes. Fifty is far past what one session
 * raises in practice and small enough to render in one pass without
 * virtualising. **Read it, never restate it**: the "dropped N" line is written
 * from this constant (`noticesModel.droppedNoticesLine`), because a cap written
 * twice is a cap that will disagree with itself.
 */
export const MAX_NOTICES = 50;

export interface NoticeLog {
  /** Newest first — the order the tab reads, and §10's stated order. */
  readonly notices: readonly Notice[];
  /** How many the bound has discarded this session, 0 until it bites. */
  readonly dropped: number;
  /**
   * Whether an **error** notice has arrived that the Notices tab has not been
   * opened since. It is what marks the console, and it is scoped to the error
   * tone on purpose: a marker that lit for every saved document would be noise,
   * and noise is how a marker stops being read (SHARED-058, call 5).
   */
  readonly unreadError: boolean;
}

export const EMPTY_NOTICE_LOG: NoticeLog = { notices: [], dropped: 0, unreadError: false };

/**
 * The log with one more notice on it, oldest discarded past {@link MAX_NOTICES}.
 * Pure, so the bound and the drop count are facts a test reaches without a
 * timer or a render.
 */
export function appendNotice(log: NoticeLog, notice: Notice): NoticeLog {
  const kept = [notice, ...log.notices];
  const over = Math.max(0, kept.length - MAX_NOTICES);
  return {
    notices: over === 0 ? kept : kept.slice(0, MAX_NOTICES),
    dropped: log.dropped + over,
    unreadError: log.unreadError || notice.tone === "error",
  };
}

export interface NoticeStore extends NoticeLog {
  /**
   * Called by the Notices tab while it is on screen: the marker's whole meaning
   * is "there is something here you have not been shown", so being shown is
   * what clears it.
   */
  readonly markNoticesRead: () => void;
}

type Notify = (notice: ToastNotice) => void;

const noop: Notify = () => undefined;

const ToastContext = createContext<Notify>(noop);

/**
 * Separate from {@link ToastContext} rather than one value with both halves:
 * the log changes on every notice, and a component that only ever *raises* a
 * toast has no reason to re-render because one was raised.
 */
const NoticeContext = createContext<NoticeStore>({
  ...EMPTY_NOTICE_LOG,
  markNoticesRead: () => undefined,
});

/** The lowest reserved slot nothing occupies, or `null` when all are taken. */
function freeSlot(current: readonly ActiveToast[]): number | null {
  for (let slot = 0; slot < MAX_TOASTS; slot++) {
    if (!current.some((toast) => toast.slot === slot)) return slot;
  }
  return null;
}

/**
 * Which toast gives up its slot to an arriving notice when every slot is taken:
 * the oldest one the person is not touching. The state array is append-only —
 * `stacked` does the ordering for the render and leaves it alone — so the first
 * match is the oldest. At most one toast is under the pointer and at most one
 * holds focus, so with three slots there is always one to find; the fallback is
 * the oldest outright, and only a cap of two or fewer could reach it.
 */
function displaced(
  current: readonly ActiveToast[],
  held: (id: number) => boolean,
): ActiveToast | undefined {
  return current.find((toast) => !held(toast.id)) ?? current[0];
}

/**
 * Pushes a toast. Outside a provider this is a no-op rather than a throw: a
 * plugin's row rendered in isolation should not crash for narrating itself.
 */
export function useToast(): Notify {
  return useContext(ToastContext);
}

/**
 * The session's notices, for the console's Notices tab and for the strip's
 * attention marker. Outside a provider it is an empty log for {@link useToast}'s
 * reason: a surface rendered in isolation reports nothing rather than crashing.
 */
export function useNotices(): NoticeStore {
  return useContext(NoticeContext);
}

export function ToastProvider({ children }: { readonly children?: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<readonly ActiveToast[]>([]);
  /** The stack's longer-lived sibling: what the session raised, after it went. */
  const [log, setLog] = useState<NoticeLog>(EMPTY_NOTICE_LOG);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** The one toast under the pointer, and the one focus is inside. */
  const pointed = useRef<number | null>(null);
  const focused = useRef<number | null>(null);
  /** Toasts whose dwell ran out while the person was still on them. */
  const overdue = useRef(new Set<number>());

  const isHeld = useCallback((id: number) => pointed.current === id || focused.current === id, []);

  const drop = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    overdue.current.delete(id);
    if (pointed.current === id) pointed.current = null;
    if (focused.current === id) focused.current = null;
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** The dwell elapsed. A toast the person is on waits for them to leave. */
  const expire = useCallback(
    (id: number) => {
      timers.current.delete(id);
      if (isHeld(id)) {
        overdue.current.add(id);
        return;
      }
      drop(id);
    },
    [drop, isHeld],
  );

  /** The person left a toast: it goes now if its dwell ran out while they were on it. */
  const settle = useCallback(
    (id: number) => {
      if (isHeld(id) || !overdue.current.has(id)) return;
      drop(id);
    },
    [drop, isHeld],
  );

  /**
   * The tab was on screen, so there is nothing unshown any more. It returns the
   * same log when nothing changes, so a tab that calls it on every notice does
   * not re-render the tree for saying so twice.
   */
  const markNoticesRead = useCallback(() => {
    setLog((current) => (current.unreadError ? { ...current, unreadError: false } : current));
  }, []);

  const notify = useCallback<Notify>(
    (notice) => {
      const id = nextId.current++;
      // The same event, recorded twice over: a toast that will go, and a notice
      // that stays. Both are written here and nowhere else.
      const at = Date.now();
      setLog((current) => appendNotice(current, { ...notice, id, at }));
      setToasts((current) => {
        const slot = freeSlot(current);
        if (slot !== null) return [...current, { ...notice, id, slot }];
        // Full: the arriving notice inherits a slot rather than shifting one.
        // The timer of the toast that leaves this way is left to fire into an
        // id that is gone, which `drop` handles as a no-op — clearing it here
        // would be a side effect inside a state updater.
        const leaving = displaced(current, isHeld);
        if (leaving === undefined) return current;
        return [
          ...current.filter((toast) => toast.id !== leaving.id),
          { ...notice, id, slot: leaving.slot },
        ];
      });
      const timer = setTimeout(() => {
        expire(id);
      }, TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [expire, isHeld],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => notify, [notify]);
  const notices = useMemo<NoticeStore>(() => ({ ...log, markNoticesRead }), [log, markNoticesRead]);
  /**
   * Highest slot first, so the DOM order is the order the stack reads
   * top-to-bottom — which is also the order Tab walks the close buttons in.
   * The slot, not this array, decides where a toast is painted.
   */
  const stacked = useMemo(() => [...toasts].sort((a, b) => b.slot - a.slot), [toasts]);

  return (
    <ToastContext.Provider value={value}>
      <NoticeContext.Provider value={notices}>{children}</NoticeContext.Provider>
      {/* `aria-live` and no `role`: the console strip's "server unreachable"
          is the surface that genuinely *is* a `role="status"`, and two of them
          would leave "the status" ambiguous. `aria-atomic="false"` keeps a new
          toast announced on its own rather than re-reading the whole stack. */}
      <div
        className="toast-wrap"
        aria-live="polite"
        aria-atomic="false"
        // The reserve is exactly the cap, and the cap is a TypeScript constant.
        style={{ gridTemplateRows: `repeat(${String(MAX_TOASTS)}, var(--toast-h))` }}
      >
        {stacked.map((toast) => (
          <div
            key={toast.id}
            className="toast"
            data-tone={toast.tone}
            data-slot={toast.slot}
            style={{ gridRow: MAX_TOASTS - toast.slot }}
            onPointerEnter={() => {
              pointed.current = toast.id;
            }}
            onPointerLeave={() => {
              if (pointed.current === toast.id) pointed.current = null;
              settle(toast.id);
            }}
            onFocus={() => {
              focused.current = toast.id;
            }}
            onBlur={() => {
              if (focused.current === toast.id) focused.current = null;
              settle(toast.id);
            }}
          >
            <span className="tick" aria-hidden="true">
              {toast.tone === "error" ? "!" : "✓"}
            </span>
            {/*
              Clamped, never grown: the box is the same box whatever is in it.
              The clamp is a cut, so it needs a reveal (SHARED-057 clause 2) —
              the `title` carries the whole notice, unconditionally, like every
              other clamped surface in this release. It is not decoration on an
              error toast: the `message` of a refusal is a server string of no
              bounded length, and it exists nowhere else in the UI. The reveal
              is reachable because a toast the pointer is on is held (see
              `ToastProvider`), so the tooltip's dwell outlives the toast's.
            */}
            <span className="msg" title={toast.message}>
              {toast.message}
            </span>
            <button
              type="button"
              className="close"
              aria-label="Dismiss"
              onClick={() => {
                drop(toast.id);
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
