import { escapeSelectorValue } from "./cssEscape";

/**
 * Google-Docs-style margin cards: measure, sort, cascade.
 *
 * `design/index.html`'s `layoutMargin()`, kept algorithm for algorithm because
 * the prototype is authoritative for look and feel (SPEC.md §11) and because
 * the routine is the whole behaviour: each card wants to sit beside its anchor,
 * no two may overlap, and the one rule that reconciles those is
 * `y = max(anchorTop, lastBottom)`.
 *
 * The measurement and the arithmetic are separated so the arithmetic can be
 * tested against synthetic offsets and heights (sprint-011 TEST-117) rather
 * than against a layout engine.
 */

/** The prototype's gap between two stacked cards. */
export const MARGIN_GUTTER_PX = 12;

export interface MarginItem {
  readonly id: string;
  /**
   * The anchor's top, relative to the main column — `null` when the thread has
   * no highlight to sit beside (an anchor the local mapping has collapsed).
   */
  readonly anchorTop: number | null;
  readonly height: number;
}

export interface MarginPlacement {
  readonly id: string;
  readonly top: number;
}

export interface MarginLayout {
  readonly cards: readonly MarginPlacement[];
  /** What the margin column must be tall enough to hold. */
  readonly minHeight: number;
}

/**
 * The prototype's routine exactly: collect with a fallback of the running
 * `lastBottom` (still `0` at collection time, so an unplaced card sorts to the
 * top and is cascaded down like any other), sort ascending, then walk.
 */
export function cascade(items: readonly MarginItem[]): MarginLayout {
  let lastBottom = 0;
  const cards = items
    .map((item) => ({ item, top: item.anchorTop ?? lastBottom }))
    .sort((left, right) => left.top - right.top)
    .map(({ item, top }) => {
      const y = Math.max(top, lastBottom);
      lastBottom = y + item.height + MARGIN_GUTTER_PX;
      return { id: item.id, top: y };
    });
  return { cards, minHeight: lastBottom };
}

/** Reads the live geometry: where each anchor is, and how tall each card is. */
export function measureMargin(main: HTMLElement, margin: HTMLElement): MarginItem[] {
  const origin = main.getBoundingClientRect().top;
  // Direct children only: a nested child thread is a `.thread-card` too, and it
  // is laid out by the card that contains it, not by this cascade.
  return [...margin.querySelectorAll<HTMLElement>(":scope > .thread-card")].map((card) => {
    const id = card.getAttribute("data-thread") ?? "";
    // The highlight itself is the anchor: it carries `data-thread`, it is in
    // the main column, and it is exactly the text the card is about.
    //
    // The pip is the fallback, and it is needed: two anchors over *identical*
    // ranges render as one span — ProseMirror cannot nest a decoration inside
    // an equal one — and its `data-thread` can only name one of them. The pips
    // are separate widgets, so there is always exactly one per thread.
    const anchor =
      main.querySelector<HTMLElement>(`.anchor-hl[data-thread="${escapeSelectorValue(id)}"]`) ??
      main.querySelector<HTMLElement>(`.anchor-pip[data-pip-thread="${escapeSelectorValue(id)}"]`);
    return {
      id,
      anchorTop: anchor === null ? null : anchor.getBoundingClientRect().top - origin,
      height: card.offsetHeight,
    };
  });
}

/** Writes the cascade back onto the DOM, touching nothing that has not moved. */
export function applyMargin(margin: HTMLElement, layout: MarginLayout): void {
  for (const card of layout.cards) {
    const element = margin.querySelector<HTMLElement>(
      `:scope > .thread-card[data-thread="${escapeSelectorValue(card.id)}"]`,
    );
    if (element === null) continue;
    const top = `${String(Math.round(card.top))}px`;
    if (element.style.top !== top) element.style.top = top;
  }
  // Guarded: setting a height on an element a ResizeObserver is watching is how
  // a layout loop starts.
  const minHeight = `${String(Math.round(layout.minHeight))}px`;
  if (margin.style.minHeight !== minHeight) margin.style.minHeight = minHeight;
}
