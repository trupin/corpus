import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * Moving a composer that landed on the evidence (UI-112).
 *
 * The comment popover opens **at the selection**, which is the right place for a
 * short quote and exactly the wrong place when the comment is about the figure
 * two lines above it. So the box can be picked up and put somewhere else.
 *
 * The gesture is the board's own, not a second kind of drag: pointer capture on
 * the handle, `pointermove`/`pointerup`/`pointercancel` on the window, a clamp
 * recomputed from the live viewport — `useColumnWidth`, which took it from
 * `useConsoleLayout`. And like those, it is **not pointer-only**: SPEC.md §10
 * adds no exclusive-pointer capability anywhere, so the handle is a real button
 * that moves the box by arrow key, a step at a time.
 *
 * **A position is per-opening.** It is state here rather than anywhere durable,
 * and it resets the moment the popover is placed against a different selection:
 * a position chosen because it cleared *that* paragraph means nothing for the
 * next one. That reset is why this hook takes the anchor position as a prop
 * rather than an initial value — the host re-renders the same component instance
 * for a second selection, so "new selection" has to be read off the props.
 */

/** One arrow press. */
export const POPOVER_DRAG_STEP = 16;

/** One arrow press with ⇧ — for crossing a column rather than nudging. */
export const POPOVER_DRAG_STEP_COARSE = 64;

/** How close to the viewport edge the box may be pushed. */
export const POPOVER_EDGE_MARGIN = 8;

export interface PopoverPoint {
  readonly top: number;
  readonly left: number;
}

export interface PopoverBox {
  readonly width: number;
  readonly height: number;
}

/**
 * The position, kept inside the viewport.
 *
 * A box wider or taller than the viewport has no in-bounds position at all; it
 * is pinned to the near edge rather than to a negative one, so what is visible
 * is the box's top-left — the quote and the handle — instead of its foot.
 */
export function clampToViewport(
  at: PopoverPoint,
  box: PopoverBox,
  viewport: PopoverBox,
): PopoverPoint {
  const clamp = (value: number, extent: number, size: number): number => {
    const limit = Math.max(POPOVER_EDGE_MARGIN, extent - size - POPOVER_EDGE_MARGIN);
    return Math.min(Math.max(value, POPOVER_EDGE_MARGIN), limit);
  };
  return {
    top: clamp(at.top, viewport.height, box.height),
    left: clamp(at.left, viewport.width, box.width),
  };
}

/** How far one key press moves the box, or `null` when the key is not a move. */
export function stepForKey(key: string, coarse: boolean): PopoverPoint | null {
  const step = coarse ? POPOVER_DRAG_STEP_COARSE : POPOVER_DRAG_STEP;
  switch (key) {
    case "ArrowUp":
      return { top: -step, left: 0 };
    case "ArrowDown":
      return { top: step, left: 0 };
    case "ArrowLeft":
      return { top: 0, left: -step };
    case "ArrowRight":
      return { top: 0, left: step };
    default:
      return null;
  }
}

function viewport(): PopoverBox {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface PopoverDrag extends PopoverPoint {
  readonly dragging: boolean;
  /** Handle props: a press starts the gesture, an arrow key steps it. */
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * @param anchor Where the host placed the box — the selection's coordinates.
 * @param box    The box itself, measured when a gesture starts.
 */
export function usePopoverDrag(
  anchor: PopoverPoint,
  box: RefObject<HTMLElement | null>,
): PopoverDrag {
  /** Where the person put it, or `null` while it is still where it opened. */
  const [moved, setMoved] = useState<PopoverPoint | null>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * A fresh selection is a fresh popover. The host renders the same element in
   * the same slot for the next one, so React keeps this instance and its state —
   * the props are the only evidence that the box is now about other words. This
   * is React's own "adjust state when a prop changes" during render, guarded by
   * the ref so it runs once per change rather than every render.
   */
  const placed = useRef(anchor);
  if (placed.current.top !== anchor.top || placed.current.left !== anchor.left) {
    placed.current = anchor;
    setMoved(null);
  }

  const at = moved ?? anchor;
  // Read by the window listeners, which are bound once per gesture rather than
  // per pixel.
  const latest = useRef(at);
  latest.current = at;
  const gesture = useRef<{
    readonly x: number;
    readonly y: number;
    readonly from: PopoverPoint;
    readonly size: PopoverBox;
  } | null>(null);

  const measure = useCallback((): PopoverBox => {
    const rect = box.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, [box]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      gesture.current = {
        x: event.clientX,
        y: event.clientY,
        from: latest.current,
        size: measure(),
      };
      setDragging(true);
      // Capture keeps the gesture alive when the pointer outruns the handle,
      // which any real drag does within a frame.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      // The default is a focus change and a text selection; the composer's field
      // must keep the caret, and the document's selection is what this comment
      // is about.
      event.preventDefault();
      event.stopPropagation();
    },
    [measure],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: globalThis.PointerEvent): void => {
      const start = gesture.current;
      if (start === null) return;
      setMoved(
        clampToViewport(
          {
            top: start.from.top + (event.clientY - start.y),
            left: start.from.left + (event.clientX - start.x),
          },
          start.size,
          viewport(),
        ),
      );
    };
    const onUp = (): void => {
      gesture.current = null;
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
  }, [dragging]);

  /**
   * **The box the host placed may not fit where it was placed** (UI-148).
   *
   * The clamp used to apply to a *move* and never to the opening, so a selection
   * near the foot of the window opened a popover whose Send button was below it
   * — reachable by `⌘↵` and by nothing a pointer could press. It has always been
   * possible; the board bar's 38px of chrome is what made it reachable at
   * 1280×720, which is the size the geometry suites measure at.
   *
   * A layout effect rather than an effect, so the off-screen position is never
   * painted, and only when the box actually overflows — a popover that fits is
   * left exactly where the host put it, which keeps it at the words it is about.
   */
  useLayoutEffect(() => {
    if (moved !== null || dragging) return;
    const size = measure();
    if (size.height === 0 && size.width === 0) return;
    const fitted = clampToViewport(anchor, size, viewport());
    if (fitted.top === anchor.top && fitted.left === anchor.left) return;
    setMoved(fitted);
  }, [anchor, dragging, measure, moved]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = stepForKey(event.key, event.shiftKey);
      if (step === null) return;
      // The reader's own arrows move between documents; a press on this handle
      // is about this handle.
      event.preventDefault();
      event.stopPropagation();
      const from = latest.current;
      setMoved(
        clampToViewport(
          { top: from.top + step.top, left: from.left + step.left },
          measure(),
          viewport(),
        ),
      );
    },
    [measure],
  );

  return { ...at, dragging, onPointerDown, onKeyDown };
}
