import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The explorer's own browser-local state: whether it is open, how wide, and
 * which folders are expanded (SPEC.md §10, rider 1 — "it retracts
 * horizontally, the way the console retracts vertically, remembers its width
 * and its open state browser-locally, and is closed by default").
 *
 * **A horizontal twin of `useConsoleLayout`, deliberately not a shared
 * abstraction.** The two hooks read the same, and generalising them over an axis
 * would buy one file at the cost of a parameterised clamp, a parameterised
 * event, and a parameterised storage shape — while the *bounds* differ for
 * reasons that have nothing to do with each other (the console's floor is a
 * readable job list, the explorer's is a readable folder name). What is shared
 * is the discipline, and that is written down in both places rather than
 * factored out of both.
 *
 * **Its own storage key**, for `useConsoleLayout`'s reason: the board blob is
 * versioned around strips and discards itself on a shape change, and the
 * explorer has no business making a board-state migration happen or inheriting
 * one. Nothing here is corpus state — a second browser is entitled to its own
 * answer.
 */

export const EXPLORER_STORAGE_KEY = "corpus.explorer";

/** Bumped when the shape below changes; an older blob degrades to defaults. */
export const EXPLORER_STATE_VERSION = 1;

/** `design/navigation.html`'s default width, and the floor the drag clamps to. */
export const DEFAULT_EXPLORER_WIDTH = 260;
export const MIN_EXPLORER_WIDTH = 180;

/**
 * The ceiling, **derived from the room** (SPEC.md §10: "a bound is derived from
 * the room, not chosen as a number"): half the window, so a wider window makes a
 * wider explorer and the board is never left with less space than the tree.
 * The prototype's flat `520` was a number measured once on one screen.
 */
export const MAX_EXPLORER_WIDTH_RATIO = 0.5;

/** How much one arrow-key press moves the handle. */
export const EXPLORER_RESIZE_STEP = 16;

export interface ExplorerLocalState {
  readonly open: boolean;
  readonly width: number;
  /**
   * Folder paths this browser has opened.
   *
   * **The set holds what is open, not what is closed, and that decides the
   * default**: a tree nobody has touched draws its top-level folders and asks
   * for nothing. A folder's documents are one `GET /api/docs?folder=…` each, so
   * the inverse spelling would issue one request per folder in the workspace on
   * the first paint — an enumeration of the corpus by another name (SPEC.md §7),
   * for a panel the user has only just opened.
   */
  readonly expanded: readonly string[];
}

export const DEFAULT_EXPLORER_STATE: ExplorerLocalState = {
  open: false,
  width: DEFAULT_EXPLORER_WIDTH,
  expanded: [],
};

/**
 * `[180px, 50vw]`, with the upper bound recomputed from the *current* viewport
 * rather than stored: a width that was half of a wide window would otherwise
 * squeeze the board toward nothing after the window shrinks.
 */
export function clampExplorerWidth(width: number, viewportWidth: number): number {
  const max = Math.max(MIN_EXPLORER_WIDTH, viewportWidth * MAX_EXPLORER_WIDTH_RATIO);
  if (!Number.isFinite(width)) return DEFAULT_EXPLORER_WIDTH;
  return Math.min(max, Math.max(MIN_EXPLORER_WIDTH, width));
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
 * version — reads as "no stored state". An explorer that will not open because
 * `localStorage` holds a string where a number belongs is a worse outcome than
 * a forgotten width.
 */
export function readExplorerState(storage: Storage | null = storageOrNull()): ExplorerLocalState {
  if (storage === null) return DEFAULT_EXPLORER_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(EXPLORER_STORAGE_KEY);
  } catch {
    return DEFAULT_EXPLORER_STATE;
  }
  if (raw === null) return DEFAULT_EXPLORER_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_EXPLORER_STATE;
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== EXPLORER_STATE_VERSION) return DEFAULT_EXPLORER_STATE;
    const open = record["open"];
    const width = record["width"];
    const expanded = record["expanded"];
    return {
      open: typeof open === "boolean" ? open : DEFAULT_EXPLORER_STATE.open,
      width:
        typeof width === "number" && Number.isFinite(width) ? width : DEFAULT_EXPLORER_STATE.width,
      expanded: Array.isArray(expanded)
        ? expanded.filter((entry): entry is string => typeof entry === "string" && entry !== "")
        : DEFAULT_EXPLORER_STATE.expanded,
    };
  } catch {
    return DEFAULT_EXPLORER_STATE;
  }
}

export function writeExplorerState(
  state: ExplorerLocalState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      EXPLORER_STORAGE_KEY,
      JSON.stringify({ version: EXPLORER_STATE_VERSION, ...state }),
    );
  } catch {
    // Quota exceeded, or storage revoked mid-session. The panel keeps working
    // from memory for this session; it just will not survive a reload.
  }
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export interface ExplorerLayout {
  readonly open: boolean;
  readonly width: number;
  readonly dragging: boolean;
  readonly toggle: () => void;
  /** Whether this folder path is drawn open — and therefore listed. */
  readonly isExpanded: (path: string) => boolean;
  readonly toggleFolder: (path: string) => void;
  /** Pointer drag on the panel's right edge. */
  readonly onResizerPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Arrow-key resizing, so the panel is not mouse-only. */
  readonly onResizerKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function useExplorerLayout(): ExplorerLayout {
  const [state, setState] = useState<ExplorerLocalState>(() => {
    const stored = readExplorerState();
    return { ...stored, width: clampExplorerWidth(stored.width, viewportWidth()) };
  });
  const [dragging, setDragging] = useState(false);
  // Pointer moves fire per pixel; a ref lets the drag read the live width
  // without the handler being rebound on every frame.
  const latest = useRef(state);
  latest.current = state;
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);

  const commit = useCallback((next: ExplorerLocalState) => {
    latest.current = next;
    setState(next);
    writeExplorerState(next);
  }, []);

  const toggle = useCallback(() => {
    commit({ ...latest.current, open: !latest.current.open });
  }, [commit]);

  const toggleFolder = useCallback(
    (path: string) => {
      const held = latest.current.expanded;
      commit({
        ...latest.current,
        expanded: held.includes(path) ? held.filter((entry) => entry !== path) : [...held, path],
      });
    },
    [commit],
  );

  const resizeTo = useCallback(
    (width: number) => {
      const clamped = clampExplorerWidth(width, viewportWidth());
      if (clamped === latest.current.width) return;
      commit({ ...latest.current, width: clamped });
    },
    [commit],
  );

  // A window that shrinks below the stored width re-clamps rather than letting
  // the panel keep a size that no longer leaves the board any room.
  useEffect(() => {
    const onResize = (): void => {
      resizeTo(latest.current.width);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [resizeTo]);

  const onResizerPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    drag.current = { x: event.clientX, width: latest.current.width };
    setDragging(true);
    // Pointer capture keeps the drag alive when the pointer outruns the 6px
    // handle, which it does immediately on any real gesture.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: PointerEvent): void => {
      const start = drag.current;
      if (start === null) return;
      // The handle is on the panel's right edge, so dragging right grows it.
      resizeTo(start.width + (event.clientX - start.x));
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
        event.key === "ArrowRight"
          ? EXPLORER_RESIZE_STEP
          : event.key === "ArrowLeft"
            ? -EXPLORER_RESIZE_STEP
            : 0;
      if (step === 0) return;
      event.preventDefault();
      resizeTo(latest.current.width + step);
    },
    [resizeTo],
  );

  const expanded = state.expanded;
  const isExpanded = useCallback((path: string) => expanded.includes(path), [expanded]);

  return useMemo(
    () => ({
      open: state.open,
      width: state.width,
      dragging,
      toggle,
      isExpanded,
      toggleFolder,
      onResizerPointerDown,
      onResizerKeyDown,
    }),
    [
      dragging,
      isExpanded,
      onResizerKeyDown,
      onResizerPointerDown,
      state.open,
      state.width,
      toggle,
      toggleFolder,
    ],
  );
}
