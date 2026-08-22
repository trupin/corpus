import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The drawer's own browser-local state: whether it is open, and how tall.
 *
 * It lives under its **own** storage key rather than inside `corpus.board`,
 * which is deliberate on both sides: the board blob is versioned around
 * per-column scroll and open readers and discards itself on a shape change, and
 * the console has no business making a board state migration happen (or
 * inheriting one). Both are "this browser's session" state, and neither is
 * corpus state — nothing here is committed, and a second browser is entitled to
 * its own answer (SPEC.md §10).
 */

export const CONSOLE_STORAGE_KEY = "corpus.console";

/** Bumped when the shape below changes; an older blob degrades to defaults. */
export const CONSOLE_STATE_VERSION = 1;

/** The prototype's default drawer height, and the drag clamps around it. */
export const DEFAULT_CONSOLE_HEIGHT = 210;
export const MIN_CONSOLE_HEIGHT = 120;
export const MAX_CONSOLE_HEIGHT_RATIO = 0.6;

/** How much one arrow-key press moves the top edge. */
export const CONSOLE_RESIZE_STEP = 16;

export interface ConsoleLocalState {
  readonly open: boolean;
  readonly height: number;
}

export const DEFAULT_CONSOLE_STATE: ConsoleLocalState = {
  open: false,
  height: DEFAULT_CONSOLE_HEIGHT,
};

/**
 * `[120px, 60vh]`, and the upper bound is recomputed from the *current*
 * viewport rather than stored: a height that was 60 vh in a tall window would
 * otherwise squeeze the board toward zero after the window shrinks.
 */
export function clampConsoleHeight(height: number, viewportHeight: number): number {
  const max = Math.max(MIN_CONSOLE_HEIGHT, viewportHeight * MAX_CONSOLE_HEIGHT_RATIO);
  if (!Number.isFinite(height)) return DEFAULT_CONSOLE_HEIGHT;
  return Math.min(max, Math.max(MIN_CONSOLE_HEIGHT, height));
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and sandboxed frames throw on the property itself.
    return null;
  }
}

/**
 * Anything unrecognised — garbage, a hand-edited value, a blob from an older
 * version — reads as "no stored state". A console that will not open because
 * `localStorage` holds a string where a number belongs is a worse outcome than
 * a forgotten drawer height.
 */
export function readConsoleState(storage: Storage | null = storageOrNull()): ConsoleLocalState {
  if (storage === null) return DEFAULT_CONSOLE_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(CONSOLE_STORAGE_KEY);
  } catch {
    return DEFAULT_CONSOLE_STATE;
  }
  if (raw === null) return DEFAULT_CONSOLE_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONSOLE_STATE;
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== CONSOLE_STATE_VERSION) return DEFAULT_CONSOLE_STATE;
    const open = record["open"];
    const height = record["height"];
    return {
      open: typeof open === "boolean" ? open : DEFAULT_CONSOLE_STATE.open,
      height:
        typeof height === "number" && Number.isFinite(height)
          ? height
          : DEFAULT_CONSOLE_STATE.height,
    };
  } catch {
    return DEFAULT_CONSOLE_STATE;
  }
}

export function writeConsoleState(
  state: ConsoleLocalState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      CONSOLE_STORAGE_KEY,
      JSON.stringify({ version: CONSOLE_STATE_VERSION, ...state }),
    );
  } catch {
    // Quota exceeded, or storage revoked mid-session. The drawer keeps working
    // from memory for this session; it just will not survive a reload.
  }
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

export interface ConsoleLayout {
  readonly open: boolean;
  readonly height: number;
  readonly dragging: boolean;
  readonly toggle: () => void;
  /** Pointer drag on the drawer's top edge. */
  readonly onResizerPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Arrow-key resizing, so the drawer is not mouse-only. */
  readonly onResizerKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function useConsoleLayout(): ConsoleLayout {
  const [state, setState] = useState<ConsoleLocalState>(() => {
    const stored = readConsoleState();
    return { open: stored.open, height: clampConsoleHeight(stored.height, viewportHeight()) };
  });
  const [dragging, setDragging] = useState(false);
  // Pointer moves fire per pixel; a ref lets the drag read the live height
  // without the handler being rebound on every frame.
  const latest = useRef(state);
  latest.current = state;
  const drag = useRef<{ readonly y: number; readonly height: number } | null>(null);

  const commit = useCallback((next: ConsoleLocalState) => {
    latest.current = next;
    setState(next);
    writeConsoleState(next);
  }, []);

  const toggle = useCallback(() => {
    commit({ ...latest.current, open: !latest.current.open });
  }, [commit]);

  const resizeTo = useCallback(
    (height: number) => {
      const clamped = clampConsoleHeight(height, viewportHeight());
      if (clamped === latest.current.height) return;
      commit({ ...latest.current, height: clamped });
    },
    [commit],
  );

  // A window that shrinks below the stored height re-clamps rather than letting
  // the drawer keep a size that no longer leaves the board any room.
  useEffect(() => {
    const onResize = (): void => {
      resizeTo(latest.current.height);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [resizeTo]);

  const onResizerPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    drag.current = { y: event.clientY, height: latest.current.height };
    setDragging(true);
    // Pointer capture keeps the drag alive when the pointer outruns the 5px
    // handle, which it does immediately on any real gesture.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: PointerEvent): void => {
      const start = drag.current;
      if (start === null) return;
      // Dragging *up* grows the drawer, so the delta is inverted.
      resizeTo(start.height + (start.y - event.clientY));
    };
    const onUp = (): void => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, resizeTo]);

  const onResizerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step =
        event.key === "ArrowUp"
          ? CONSOLE_RESIZE_STEP
          : event.key === "ArrowDown"
            ? -CONSOLE_RESIZE_STEP
            : 0;
      if (step === 0) return;
      event.preventDefault();
      resizeTo(latest.current.height + step);
    },
    [resizeTo],
  );

  return useMemo(
    () => ({
      open: state.open,
      height: state.height,
      dragging,
      toggle,
      onResizerPointerDown,
      onResizerKeyDown,
    }),
    [dragging, onResizerKeyDown, onResizerPointerDown, state.height, state.open, toggle],
  );
}
