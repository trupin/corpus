import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Keeping the reader's popovers inside the viewport.
 *
 * The prototype anchors `.comments-pop` to the right edge of the reader head
 * (`position: absolute; right: 12px`), which is correct until the column is the
 * last one on a horizontally scrolled board — then a 300px popover hangs off the
 * screen with no way to scroll to it, because the board scrolls and the popover
 * does not.
 *
 * The fix is a measured shift rather than a flip: the popover keeps its anchor
 * and slides just far enough to fit.
 */

export const POPOVER_MARGIN = 8;

/**
 * How far **left** (positive) a popover must move to sit inside the viewport;
 * negative moves it right.
 *
 * Both directions matter, and for the same reason: the board scrolls
 * horizontally under a popover that is anchored to a column, so the anchor can
 * end up near either edge.
 */
export function popoverShift(
  rect: { readonly left: number; readonly right: number },
  viewportWidth: number,
  margin: number = POPOVER_MARGIN,
): number {
  const overflowRight = rect.right - (viewportWidth - margin);
  if (overflowRight > 0) {
    // Never push the left edge out of view to rescue the right one: a popover
    // wider than the viewport is clipped on the right, which is at least
    // readable from the start.
    return Math.min(overflowRight, Math.max(0, rect.left - margin));
  }
  const overflowLeft = margin - rect.left;
  if (overflowLeft > 0) {
    return -Math.min(overflowLeft, Math.max(0, viewportWidth - margin - rect.right));
  }
  return 0;
}

/**
 * Measures the element and returns the `translateX` it should carry.
 *
 * A layout effect, because the popover must never be painted in the wrong place
 * first. jsdom reports every rect as zero and therefore always yields `0`, which
 * is the correct answer for a viewport with no layout.
 */
export function usePopoverShift(ref: RefObject<HTMLElement | null>, open: boolean): number {
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!open || ref.current === null) {
      setShift(0);
      return;
    }
    setShift(popoverShift(ref.current.getBoundingClientRect(), globalThis.innerWidth));
  }, [open, ref]);

  return shift;
}
