/**
 * Column width, as a property of the view document (SPEC.md §11).
 *
 * *"Column width is part of the column: every column's width is user-adjustable
 * by dragging its edge… Like `order`, the chosen width lives in the view
 * document's frontmatter — synced to every browser, auto-committed… and
 * agent-stewardable."*
 *
 * Which is why nothing here touches `localStorage`. Scroll positions and open
 * readers are this browser's; a column's width describes the **view**, not the
 * viewer, and it therefore travels with the document like `order`, `query` and
 * `pinned` do.
 *
 * The stored value is an ordinary `extra` frontmatter key. The server neither
 * validates nor interprets it (`ExtraFrontmatterSchema` is `z.unknown()` by
 * design), so this module is the only place a hand-edited or agent-written
 * value can be caught — hence {@link readStoredWidth}, which answers "no width"
 * to everything that is not a usable number rather than letting a string blank
 * the board.
 */

/** The shipped column width — `design/index.html`'s `.col`, and the default. */
export const DEFAULT_COLUMN_WIDTH = 336;

/** Narrow enough to be a sliver, wide enough to still be a column. */
export const MIN_COLUMN_WIDTH = 240;
export const MAX_COLUMN_WIDTH = 960;

/**
 * How much a column grows when it opens a reader.
 *
 * The prototype's two constants were `336` and `560`; this is the ratio between
 * them, so a column left at the default still widens to exactly `560`, and a
 * column the user made narrow or wide widens **relative to its own base**
 * rather than jumping to a fixed size (sprint-016 TEST-450).
 */
export const READING_WIDTH_RATIO = 560 / 336;

/** How much one arrow-key press moves the edge. Matches the console's step. */
export const COLUMN_RESIZE_STEP = 16;

/**
 * Clamped against the **current** viewport rather than a stored ceiling — the
 * same rule `clampConsoleHeight` follows, and for the same reason: a width
 * chosen on a wide display must not leave a laptop with a column it cannot
 * scroll past.
 */
export function clampColumnWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  const room = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth - 48 : Infinity;
  const max = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, room));
  return Math.round(Math.min(max, Math.max(MIN_COLUMN_WIDTH, width)));
}

/**
 * The width a view document carries, or `null` when it carries none usable.
 *
 * Total by construction: `extra` is an open map the server never reads, so a
 * string, a negative number, `NaN` or an object all mean the same thing here —
 * "this column has no chosen width" — and the board renders at its default
 * (sprint-016 TEST-452).
 */
export function readStoredWidth(
  extra: Readonly<Record<string, unknown>> | undefined,
): number | null {
  const raw = extra?.["width"];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/** The width a column renders at: its base, widened while a reader is open. */
export function renderedWidth(base: number, reading: boolean, viewportWidth: number): number {
  return clampColumnWidth(reading ? base * READING_WIDTH_RATIO : base, viewportWidth);
}
