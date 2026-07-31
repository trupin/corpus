import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { applyMargin, cascade, measureMargin } from "./marginLayout";

/**
 * Keeps the margin cascade true, on every event that can invalidate it.
 *
 * The list is not open-ended — each entry is a thing that moves an anchor or
 * changes a card's height (sprint-011 TEST-118):
 *
 * - the first render, and every change to which threads are shown;
 * - a card growing or shrinking — expanding, collapsing, a reply appended —
 *   watched per card, because absolutely positioned cards change no ancestor's
 *   box and a `ResizeObserver` on the column alone would never fire;
 * - the main column reflowing, which is what an editor content-height change
 *   and a window resize both look like from here;
 * - the fonts finishing loading, which moves every anchor at once.
 *
 * All of them funnel into one animation frame: a burst of observer callbacks
 * during a resize drag must cost one layout pass, not thirty.
 */

export interface MarginLayoutOptions {
  readonly main: RefObject<HTMLElement | null>;
  readonly margin: RefObject<HTMLElement | null>;
  /** Off in chip mode: nothing is measured and nothing is written. */
  readonly active: boolean;
  /** Changing this re-observes: the set of cards is different. */
  readonly threadIds: readonly string[];
}

export function useMarginLayout({ main, margin, active, threadIds }: MarginLayoutOptions): void {
  const frame = useRef<number | null>(null);

  const relayout = useCallback((): void => {
    const mainElement = main.current;
    const marginElement = margin.current;
    if (!active || mainElement === null || marginElement === null) return;
    applyMargin(marginElement, cascade(measureMargin(mainElement, marginElement)));
  }, [active, main, margin]);

  const schedule = useCallback((): void => {
    if (frame.current !== null) return;
    // jsdom and any environment without a frame clock still lay out — just
    // synchronously.
    if (typeof requestAnimationFrame !== "function") {
      relayout();
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      relayout();
    });
  }, [relayout]);

  // A layout effect: the cards are absolutely positioned, so until this runs
  // they are all at `top: 0` and the reader would see them stacked.
  useLayoutEffect(() => {
    schedule();
  }, [schedule, threadIds]);

  useEffect(() => {
    const mainElement = main.current;
    const marginElement = margin.current;
    if (!active || mainElement === null || marginElement === null) return undefined;

    window.addEventListener("resize", schedule);
    const fonts: FontFaceSet | undefined = document.fonts;
    void fonts?.ready.then(schedule);

    if (typeof ResizeObserver !== "function") {
      return () => {
        window.removeEventListener("resize", schedule);
      };
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(mainElement);
    for (const card of marginElement.querySelectorAll<HTMLElement>(":scope > .thread-card")) {
      observer.observe(card);
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [active, main, margin, schedule, threadIds]);

  /**
   * A cancelled frame is not a pending one.
   *
   * Clearing the handle as well as the callback is the whole of it: React's
   * StrictMode runs every effect's cleanup once before the real mount, so a
   * cancel that left the handle set would leave {@link schedule} convinced a
   * layout pass was already coming and the margin would never be positioned at
   * all. Found in the browser, where the cards sat stacked at `top: 0`.
   */
  useEffect(
    () => () => {
      if (frame.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame.current);
      }
      frame.current = null;
    },
    [],
  );
}
