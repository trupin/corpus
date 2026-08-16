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

/**
 * How wide a reading column can usefully get: the reader's content measure.
 *
 * Widening past where the content stops buys nothing — it buys dead gutter, and
 * a column dragged to 900 px opened a reader that was 900 px of chrome around
 * 517 px of text (UI-023). So the widening has a ceiling, and the ceiling is the
 * measure itself, derived from the stylesheet that draws it:
 *
 * - `.doc-body` (`@corpus/kit/markdown.css`) caps the body at `62ch` at 15 px in
 *   `--serif`. Measured in Chromium against the shipped stylesheet, `62ch`
 *   resolves to **517.2 px** (Iowan Old Style / Charter — the first two
 *   families of `--serif` that a machine is likely to have). The other elements
 *   in the reader that carry a measure — `.thread-card`, `.backlinks`, the
 *   banners — are capped at the same `62ch`.
 *
 *   **The title is no longer one of them, and the derivation below does not
 *   depend on it.** `.title-grow` (UI-065) carries `62ch` too, but it also
 *   carries the title's own 24 px type, and `ch` resolves against the element's
 *   own font — so its cap is ≈744 px and never binds inside a column this
 *   ceiling holds to ~530 px of content. `width: 100%` decides the title's
 *   width, which is what `design/index.html` draws. Recorded because this
 *   comment previously listed `.doc-title` as sharing the 517 px measure and it
 *   no longer does (PR #21 re-review, MINOR 3).
 * - `.col .reader-scroll` (`Column.css`) pads it by `12px 14px`: **+28 px**.
 * - `.col` is `border-box` with a 1 px border on each side: **+2 px**.
 *
 * 517.2 + 28 + 2 = **547.2 px** of content measure on this machine — and `ch` is
 * font-dependent, so the same CSS lands between ~495 px (Palatino, Times) and
 * ~601 px (Georgia) on machines where `--serif` falls through differently, and
 * platforms with classic (non-overlay) scrollbars spend another 8 px of the
 * column on `.reader-scroll`'s scrollbar.
 *
 * The prototype's own reading width, **560**, is the constant that sits in that
 * band: it covers the reference-font measure with just enough slack for the
 * scrollbar, and it is what `design/index.html` already calls a full reading
 * column. Taking it as the ceiling is therefore both the honest measure and the
 * mockup's number — which is why a default column still opens at exactly 560
 * (`DEFAULT_COLUMN_WIDTH × READING_WIDTH_RATIO`, sprint-016 TEST-450) while a
 * column dragged wider than the measure opens at the measure instead of past it.
 */
export const READING_WIDTH_CEILING = 560;

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

/**
 * The width a reader needs to show its content readably — the **floor** a column
 * may be grown to when something is opened in it, never a ceiling on the width
 * the user chose.
 *
 * That distinction is the whole of UI-113. This value used to be applied as
 * `min(base × ratio, ceiling)`, which capped a wide column at the measure: open
 * a document in a column dragged to 800 and it *narrowed* to 560. The reasoning
 * was that width past the measure is gutter — true of a column nobody chose, and
 * false of one somebody dragged. Reported by the user with two screenshots and
 * the rule to replace it: *"I want a column to keep its width… When I click on a
 * button I don't want to see the column width redimension on its own ever"*,
 * qualified to *"it can resize up automatically but not down"*.
 */
export function readingFloor(base: number, viewportWidth: number): number {
  return Math.min(
    clampColumnWidth(base * READING_WIDTH_RATIO, viewportWidth),
    READING_WIDTH_CEILING,
  );
}

/**
 * The width a column renders at: **the wider of its own base and any floor it
 * has already been grown to**.
 *
 * A one-way ratchet, and both directions matter:
 *
 * - **Up, automatically.** A column too narrow to show a document grows to the
 *   reading floor when one is opened, which is the behaviour a default column
 *   has always had.
 * - **Down, never — including on close.** The grown width stays after the reader
 *   closes. Returning to the base would be the app resizing the column downward
 *   on its own, which is the complaint, and "but it went back to what you set"
 *   is still the app moving something the user was looking at.
 *
 * The floor is **transient**, held in the board rather than written to the view
 * document. Persisting it would mean a git commit every time a document was
 * opened in a narrow column (`useColumnWidth` writes `extra.width` per gesture,
 * one history entry per resize by design) — the app quietly editing a document
 * because you clicked something.
 *
 * A user's own resize clears the floor: their gesture is the authority on width,
 * and a floor that outlived it would make the column refuse to be narrowed.
 */
export function renderedWidth(base: number, floor: number, viewportWidth: number): number {
  return Math.max(
    clampColumnWidth(base, viewportWidth),
    Math.min(floor, clampColumnWidth(floor, viewportWidth)),
  );
}
