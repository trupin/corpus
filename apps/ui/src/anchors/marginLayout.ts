import { escapeSelectorValue } from "./cssEscape";

/**
 * Google-Docs-style margin cards: measure, sort, cascade.
 *
 * `design/index.html`'s `layoutMargin()`, kept algorithm for algorithm because
 * the prototype is authoritative for look and feel (SPEC.md §10) and because
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
 * The prototype's routine — collect a wanted top per card, sort ascending, then
 * walk with `y = max(wanted, lastBottom)` — with one correction to how a card
 * with **no measurable anchor** is collected.
 *
 * `items` arrive in document order, so the honest answer for a card whose
 * highlight is not on screen is *where the document had got to*: the top of the
 * last card that did have one. The prototype wrote `lastBottom`, which is still
 * `0` during collection and therefore sorts **every** such card to the very top
 * of the margin — so a document where no highlight can be drawn at all stacked
 * its whole conversation against the title, and deleting an anchored phrase
 * teleported its card up there until the text was retyped (UI-062).
 *
 * A card without an anchor is normally not in this list at all: the layer above
 * lists those below the body (`anchorPlacement.segmentsOf`). This is the
 * transient case — a highlight the editor has momentarily collapsed — and
 * keeping it in document order is what stops the transient from being a jump.
 */
export function cascade(items: readonly MarginItem[]): MarginLayout {
  let lastAnchored = 0;
  let lastBottom = 0;
  const cards = items
    .map((item) => {
      const top = item.anchorTop ?? lastAnchored;
      lastAnchored = top;
      return { item, top };
    })
    // Stable, so cards sharing a wanted top keep document order.
    .sort((left, right) => left.top - right.top)
    .map(({ item, top }) => {
      const y = Math.max(top, lastBottom);
      lastBottom = y + item.height + MARGIN_GUTTER_PX;
      return { id: item.id, top: y };
    });
  return { cards, minHeight: lastBottom };
}

/** Reads the live geometry: where each anchor is, and how tall each panel is. */
export function measureMargin(main: HTMLElement, margin: HTMLElement): MarginItem[] {
  const origin = main.getBoundingClientRect().top;
  /*
   * Direct children only, and by the **panel** marker rather than by the card's
   * class: a conversation in the margin is a card when it is expanded and a
   * single line when it is folded (SPEC.md §10), and both have to be cascaded —
   * a fold that dropped out of the layout would leave the ones below it stacked
   * where the card used to be. A nested child thread is a panel too, and it is
   * laid out by the card that contains it, not by this cascade.
   */
  return [...margin.querySelectorAll<HTMLElement>(":scope > [data-thread-panel]")].map((card) => {
    const id = card.getAttribute("data-thread-panel") ?? "";
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
      `:scope > [data-thread-panel="${escapeSelectorValue(card.id)}"]`,
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
