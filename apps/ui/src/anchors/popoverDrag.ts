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
 * Placing a composer, and moving one that landed on the evidence (UI-112,
 * UI-159).
 *
 * The comment popover opens **at the selection**, which is the right place for a
 * short quote and exactly the wrong place when the comment is about the figure
 * two lines above it. So the box can be picked up and put somewhere else.
 *
 * Two different bounds live here and they are not the same bound. **Where the
 * box is put is derived from the room the chrome has left** — the board's own
 * rectangle, which is what the bands above and below it did not take. **Where a
 * person may carry it is the screen**, because a deliberate gesture answers to
 * nothing but reachability. Confusing the two is how UI-159 happened: the
 * derivation wrote its answer into the slot the gesture writes to, so a box the
 * code had adjusted looked carried, and was never adjusted again.
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

/** How far the box sits off the words it is about, on whichever side it takes. */
export const POPOVER_ANCHOR_GAP = 6;

/**
 * The attribute a surface marks itself with to say *this is the room a popover
 * opens into* (UI-159).
 *
 * It is on the board — the flex child that is given whatever the chrome above
 * and below it does not take — so the room is **the chrome's own layout
 * result** rather than a subtraction anybody has to keep up to date. Another
 * band added above the board (a board bar, a column strip, the next one) shrinks
 * this rectangle by construction, and nothing here changes.
 */
export const POPOVER_ROOM_ATTRIBUTE = "data-popover-room";

export interface PopoverPoint {
  readonly top: number;
  readonly left: number;
}

export interface PopoverBox {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in viewport coordinates: a room, or the screen itself. */
export interface PopoverRect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where the words are, as the two edges a box can be put against.
 *
 * Not a single point, because a point cannot be flipped: choosing between the
 * space under the quote and the space over it needs both edges of the quote,
 * and `top`/`left` only ever carried one of them.
 */
export interface PopoverAnchor {
  /** The y a box placed **under** the words starts at. */
  readonly below: number;
  /** The y a box placed **over** the words ends at. */
  readonly above: number;
  /** The x either placement starts at. */
  readonly left: number;
}

/**
 * The position, kept inside a rectangle.
 *
 * A box wider or taller than the rectangle has no in-bounds position at all; it
 * is pinned to the near edge rather than to a negative one, so what is visible
 * is the box's top-left — the quote and the handle — instead of its foot.
 */
export function clampToRect(at: PopoverPoint, box: PopoverBox, room: PopoverRect): PopoverPoint {
  const clamp = (value: number, near: number, far: number, size: number): number => {
    const start = near + POPOVER_EDGE_MARGIN;
    const limit = Math.max(start, far - size - POPOVER_EDGE_MARGIN);
    return Math.min(Math.max(value, start), limit);
  };
  return {
    top: clamp(at.top, room.top, room.bottom, box.height),
    left: clamp(at.left, room.left, room.right, box.width),
  };
}

/** {@link clampToRect} against the screen, which is the bound on a deliberate move. */
export function clampToViewport(
  at: PopoverPoint,
  box: PopoverBox,
  viewport: PopoverBox,
): PopoverPoint {
  return clampToRect(at, box, { top: 0, left: 0, right: viewport.width, bottom: viewport.height });
}

/** Whether a box at this position is wholly inside a rectangle. */
export function fitsInRect(at: PopoverPoint, box: PopoverBox, room: PopoverRect): boolean {
  return (
    at.top >= room.top &&
    at.top + box.height <= room.bottom &&
    at.left >= room.left &&
    at.left + box.width <= room.right
  );
}

/**
 * Where a box of this size goes, given the words and the room (UI-159).
 *
 * **The side is derived, never preferred.** The anchor cuts the room in two, and
 * the box takes the larger part — under the words when the room under them is
 * the larger, over them when it is not. That is SHARED-061's *"a bound is
 * derived from the room… the space between the anchor and the edge"* applied to
 * a placement rather than to a size, and it is what makes the composer survive
 * chrome it was never measured against: a band added above the board pushes the
 * words down, which takes room off one side and gives it to the other, and the
 * arithmetic that reads those two numbers needs no revision.
 *
 * The old rule was *"under the words, and pulled up if it overflows"*. It is
 * what put Send off-screen twice: pulling up keeps the box on the screen only
 * for the size it had at that instant, and it leaves a box that fits *just* —
 * 47px to spare — wedged against the foot with nowhere left to be moved to.
 *
 * The two clamps are not one clamp twice. The first keeps the box in its room,
 * which is the honest place for it. The second is the floor under everything: a
 * box too tall for its room still has to be reachable, so the screen wins the
 * last word (§10's "where a floor and a ceiling meet").
 */
export function placeInRoom(
  anchor: PopoverAnchor,
  box: PopoverBox,
  room: PopoverRect,
  screen: PopoverBox,
): PopoverPoint {
  const under = room.bottom - POPOVER_EDGE_MARGIN - anchor.below;
  const over = anchor.above - POPOVER_EDGE_MARGIN - room.top;
  const top = under >= over ? anchor.below : anchor.above - box.height;
  return clampToViewport(clampToRect({ top, left: anchor.left }, box, room), box, screen);
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

/** The surface that says what the room is, or `null` when nothing has said. */
function roomElement(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(`[${POPOVER_ROOM_ATTRIBUTE}]`);
}

/**
 * The room a popover opens into: what the chrome actually present has left.
 *
 * Measured rather than declared — the marked surface is a flex child, so its
 * rectangle already is the viewport minus every band above and below it. It is
 * intersected with the screen so a room scrolled partly out of view cannot
 * offer room that is not there, and a host with no marked surface at all (a
 * component test, a popover outside the shell) falls back to the screen, which
 * is the widest honest answer rather than a guess.
 */
export function popoverRoom(): PopoverRect {
  const size = viewport();
  const screen: PopoverRect = { top: 0, left: 0, right: size.width, bottom: size.height };
  const rect = roomElement()?.getBoundingClientRect();
  if (rect === undefined || rect.height <= 0 || rect.width <= 0) return screen;
  return {
    top: Math.max(screen.top, rect.top),
    left: Math.max(screen.left, rect.left),
    right: Math.min(screen.right, rect.right),
    bottom: Math.min(screen.bottom, rect.bottom),
  };
}

export interface PopoverDrag extends PopoverPoint {
  readonly dragging: boolean;
  /** Handle props: a press starts the gesture, an arrow key steps it. */
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * @param anchor The words the box is about — the two edges it may be put against.
 * @param box    The box itself, measured whenever it or its room changes.
 */
export function usePopoverDrag(
  anchor: PopoverAnchor,
  box: RefObject<HTMLElement | null>,
): PopoverDrag {
  /**
   * Where the person put it, or `null` while it is still where it was placed.
   *
   * **Kept apart from the derived position, which is UI-159's whole defect.**
   * The opening clamp used to write here, so a box the code had adjusted was
   * indistinguishable from a box the person had carried — and the derivation,
   * which runs only for a box nobody has moved, never ran again. The box then
   * grew by an attachment chip from a top that was already at the foot of the
   * screen, and put its Send button 42px below the viewport.
   */
  const [moved, setMoved] = useState<PopoverPoint | null>(null);
  /** Where the derivation put it, or `null` before it has been measured once. */
  const [placed, setPlaced] = useState<PopoverPoint | null>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * A fresh selection is a fresh popover. The host renders the same element in
   * the same slot for the next one, so React keeps this instance and its state —
   * the props are the only evidence that the box is now about other words. This
   * is React's own "adjust state when a prop changes" during render, guarded by
   * the ref so it runs once per change rather than every render.
   */
  const words = useRef(anchor);
  if (
    words.current.below !== anchor.below ||
    words.current.above !== anchor.above ||
    words.current.left !== anchor.left
  ) {
    words.current = anchor;
    setMoved(null);
    setPlaced(null);
  }

  // Until the first measurement the box is drawn under the words, which is
  // where it used to open; the layout effect below replaces that before paint.
  const at = moved ?? placed ?? { top: anchor.below, left: anchor.left };
  // Read by the window listeners, which are bound once per gesture rather than
  // per pixel.
  const latest = useRef(at);
  latest.current = at;
  const carried = useRef(moved);
  carried.current = moved;
  const derived = useRef(placed);
  derived.current = placed;
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
   * **The box the host placed may not fit where it was placed** (UI-148,
   * UI-159).
   *
   * A box nobody has carried is *placed*, and placing it is not an event that
   * happens once. It is an answer to three live questions — how big the box is,
   * where the words are, and how much room the chrome has left — and every one
   * of them changes after the popover opens: an attachment chip makes the box
   * 50px taller, a window resize moves both edges, a console drawer takes a band
   * off the foot. UI-148 ran this once, at the opening, and wrote its answer
   * into `moved`, which is exactly why a chip added afterwards pushed Send off
   * the screen with nothing left to notice.
   *
   * So it runs after **every** render, and the observers below cover the changes
   * that arrive without one. A layout effect, so no off-screen position is ever
   * painted.
   *
   * **A box that still fits is left alone**, which is the other half of §10: a
   * surface that re-placed itself on every change would move under the pointer
   * of the person typing into it, and the answer to a box that has grown is to
   * put it back in the room rather than to re-decide a placement that is still
   * good. So this asks one question — *is the box still inside its room and on
   * the screen?* — and does nothing at all while the answer is yes.
   *
   * A box the person **has** carried keeps their position — it is theirs, not a
   * derivation — and is only kept on the screen, which is the same bound their
   * drag was under.
   */
  const reposition = useCallback((): void => {
    const size = measure();
    if (size.height === 0 && size.width === 0) return;
    const screen = viewport();
    const screenRect: PopoverRect = { top: 0, left: 0, right: screen.width, bottom: screen.height };
    const carriedTo = carried.current;
    const settle =
      (next: PopoverPoint) =>
      (current: PopoverPoint | null): PopoverPoint =>
        current !== null && current.top === next.top && current.left === next.left ? current : next;
    if (carriedTo !== null) {
      if (fitsInRect(carriedTo, size, screenRect)) return;
      setMoved(settle(clampToViewport(carriedTo, size, screen)));
      return;
    }
    const room = popoverRoom();
    // `null` until the box has been placed once: the first placement is never
    // skipped, because the position it would be judged on is the raw anchor —
    // which is the side nobody has chosen yet.
    const here = derived.current;
    if (here !== null && fitsInRect(here, size, room) && fitsInRect(here, size, screenRect)) return;
    setPlaced(settle(placeInRoom(words.current, size, room, screen)));
  }, [measure]);

  useLayoutEffect(() => {
    if (dragging) return;
    reposition();
  });

  /**
   * The changes that arrive without a render of this component: an image inside
   * an attachment chip that decodes late, a window resize, a drawer that takes a
   * band off the room. Observed rather than polled, and on the room as well as
   * on the box, because "the chrome above it changed" is the case this issue is
   * about.
   */
  useEffect(() => {
    if (dragging) return undefined;
    const onResize = (): void => {
      reposition();
    };
    window.addEventListener("resize", onResize);
    if (typeof ResizeObserver !== "function") {
      return () => {
        window.removeEventListener("resize", onResize);
      };
    }
    const observer = new ResizeObserver(onResize);
    if (box.current !== null) observer.observe(box.current);
    const room = roomElement();
    if (room !== null) observer.observe(room);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [box, dragging, reposition]);

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
