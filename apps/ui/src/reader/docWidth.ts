/**
 * How wide the document body is drawn in **full screen** (SPEC.md §10, rider
 * signed 2026-08-23, replacing the body-width rider of 2026-08-04).
 *
 * > *"In a column the body is as wide as the column: the column's own edge is
 * > the single gesture, and the body follows it with no second act. … Full
 * > screen is the other case, and it keeps its control. There is no column edge
 * > in full screen, so the body's own width is the one gesture there. It is
 * > sticky in the browser-local set, it survives navigation and reload, and it
 * > is unrelated to any column's width."*
 *
 * This module used to store one width **per surface** — every column reader
 * plus focus mode, keyed by UI-077's surface keys, with an eviction cap because
 * columns come and go. The rider deleted the column half: a column's body fills
 * the column, so the column's width (its view document's, `board/columnWidth.ts`)
 * is the only number, and the browser stores nothing for it. What remains is
 * exactly one surface — full screen — so the state is one optional number.
 *
 * Two decisions survive the narrowing, because their reasons do:
 *
 * - **Nothing here is ever written to the corpus.** Every write in this product
 *   goes through the server and auto-commits (§4, §7), so a reading posture
 *   stored in the document would mean *reading a document produces git
 *   commits*. §10 puts full screen's chosen width in the browser-local set by
 *   name, beside the console's height and a conversation's collapse state.
 * - **The stored blob keeps its shape and its version.** The serialized form is
 *   still `{version, surfaces}` under {@link DOC_WIDTH_STATE_VERSION} 1: the
 *   version is documented as "a change re-asserts the default", so bumping it
 *   would throw away the full-screen width the rider explicitly keeps. The
 *   reader takes only the focus key out of an old blob; the writer emits only
 *   the focus key, which is what prunes the dead column entries — on the next
 *   choice, never as a migration pass.
 */

import { FOCUS_SURFACE } from "../thread/threadCollapse";

export const DOC_WIDTH_STORAGE_KEY = "corpus.docWidth";

/**
 * Bumped when the shape below changes, or when the stylesheet's own default
 * measure moves — an older blob degrades to the default rather than pinning the
 * surface to a number that meant something else. **Not** bumped by the 2026-08-23
 * rider: the blob's shape did not change, only how much of it is read, and a
 * bump here is precisely how a kept width would have been lost.
 */
export const DOC_WIDTH_STATE_VERSION = 1;

/**
 * Narrow enough to still be a deliberate choice, and wide enough to stay
 * readable. Below this the body stops being a document and starts being a
 * gutter, and no reported complaint is about documents being too wide.
 */
export const MIN_DOC_WIDTH = 320;

/**
 * A ceiling on the *stored* number only. What actually binds is the host — a
 * `max-width` can never make a block wider than the box it sits in — so this
 * exists to keep a hand-edited or stale value from meaning "infinity" on a
 * display that later gets smaller.
 */
export const MAX_DOC_WIDTH = 2400;

/** How much one arrow-key press moves the edge. Matches the column's step. */
export const DOC_WIDTH_STEP = 16;

/**
 * What the margin column costs the body when it is up: 300px of card plus the
 * 30px gap, which is the grid `.focus-inner.with-margin` (FocusMode.css)
 * declares.
 *
 * Subtracted from the room a drag may claim, so the pointer and the body's edge
 * stay together: without it the last 330px of a drag would move the pointer and
 * nothing else, and dragging back would do nothing until it re-crossed the
 * boundary — the dead zone that makes a resize feel broken. Full screen is the
 * only surface that still drags, so this is full screen's number now; in a
 * column the grid `.reader-scroll.with-margin` (anchors.css) decides, because
 * the body's track is what the body fills.
 */
export const MARGIN_COLUMN_RESERVE = 330;

/** Full screen's chosen width, or `null` while the stylesheet's default holds. */
export interface DocWidthState {
  readonly version: number;
  readonly focus: number | null;
}

export const EMPTY_DOC_WIDTH_STATE: DocWidthState = {
  version: DOC_WIDTH_STATE_VERSION,
  focus: null,
};

/**
 * A chosen width, held to what the host can actually show.
 *
 * `room` is what is left between the body's left edge and the end of the
 * reader's content box. It is passed in rather than measured here so the
 * arithmetic can be tested without a layout engine — the same split
 * `anchors/marginLayout.ts` makes.
 */
export function clampDocWidth(width: number, room: number): number {
  if (!Number.isFinite(width)) return MIN_DOC_WIDTH;
  const ceiling = Number.isFinite(room) && room > 0 ? Math.min(MAX_DOC_WIDTH, room) : MAX_DOC_WIDTH;
  return Math.round(Math.min(Math.max(ceiling, MIN_DOC_WIDTH), Math.max(MIN_DOC_WIDTH, width)));
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
 * version — reads as "nobody has chosen a width". Losing a width costs a drag;
 * throwing here is a reader that will not open.
 *
 * Only the focus key is read. A blob written before the 2026-08-23 rider holds
 * per-column entries beside it; they name surfaces that no longer store a
 * width, so they are ignored here and dropped by the next write.
 */
export function readDocWidthState(storage: Storage | null = storageOrNull()): DocWidthState {
  if (storage === null) return EMPTY_DOC_WIDTH_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(DOC_WIDTH_STORAGE_KEY);
  } catch {
    return EMPTY_DOC_WIDTH_STATE;
  }
  if (raw === null) return EMPTY_DOC_WIDTH_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_DOC_WIDTH_STATE;
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== DOC_WIDTH_STATE_VERSION) return EMPTY_DOC_WIDTH_STATE;
    const stored = record["surfaces"];
    if (typeof stored !== "object" || stored === null) return EMPTY_DOC_WIDTH_STATE;
    const focus = (stored as Record<string, unknown>)[FOCUS_SURFACE];
    if (typeof focus === "number" && Number.isFinite(focus) && focus > 0) {
      return { version: DOC_WIDTH_STATE_VERSION, focus };
    }
    return EMPTY_DOC_WIDTH_STATE;
  } catch {
    return EMPTY_DOC_WIDTH_STATE;
  }
}

/**
 * Serializes under the stored blob's original `{version, surfaces}` shape, and
 * emits **only** the focus key — which is what quietly prunes the per-column
 * entries an older build left behind.
 */
export function writeDocWidthState(
  state: DocWidthState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  const surfaces: Record<string, number> = {};
  if (state.focus !== null) surfaces[FOCUS_SURFACE] = state.focus;
  try {
    storage.setItem(DOC_WIDTH_STORAGE_KEY, JSON.stringify({ version: state.version, surfaces }));
  } catch {
    // Quota exceeded, or storage revoked mid-session. The surface keeps its
    // width for this session; it just will not survive a reload.
  }
}

/**
 * Forgets the chosen width.
 *
 * For the jsdom suites' `afterEach`: a width outlives a component and a
 * document by design, so without this one test's drag is the next one's
 * starting state. Nothing in the app calls it — there is no "forget my width"
 * action, and §10 describes none.
 */
export function clearDocWidthState(storage: Storage | null = storageOrNull()): void {
  try {
    storage?.removeItem(DOC_WIDTH_STORAGE_KEY);
  } catch {
    // Same shrug as the writer's: there was nothing to clear.
  }
}
