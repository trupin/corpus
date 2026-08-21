/**
 * How wide the document body is drawn, and who decided (SPEC.md §11, rider
 * signed 2026-08-04).
 *
 * > *"The document body has a comfortable default width, and the reader can
 * > **change it** — in column view and in full screen — with the width
 * > persisting across navigation and reload the way the rest of the app's
 * > navigation state is sticky. Widening applies to the whole body uniformly,
 * > prose included. Anchored thread placement follows the body when it moves,
 * > and the control is operable from the keyboard like every other affordance."*
 *
 * Three decisions are worth stating here, because each one had a live
 * alternative:
 *
 * - **The width belongs to the surface, not to the document.** §11 asks for a
 *   width that persists *across navigation*, and navigation is exactly what
 *   changes the document — so a per-document width would be re-set on every
 *   ref followed, which is the opposite of what the sentence promises. What a
 *   person is expressing when they drag is "documents in this reader read too
 *   narrow", and that outlives the document they happened to be reading. So the
 *   unit is **a reader** — a column's, or focus mode's.
 * - **The keys are UI-077's keys** — `columnSurface(columnId)` and
 *   `FOCUS_SURFACE` from `thread/threadCollapse.ts`, which the two hosts pass
 *   in, rather than a second naming scheme. Width and collapse are the
 *   same shape of state on the same surfaces, and two adjacent per-surface
 *   stores with different conventions is how they drift (UI-066's own brief).
 * - **Nothing here is ever written to the corpus.** Every write in this product
 *   goes through the server and auto-commits (§4, §7), so a reading posture
 *   stored in the document would mean *reading a document produces git
 *   commits*. §11 puts the reader's chosen width in the browser-local set by
 *   name, beside the console's height and a conversation's collapse state.
 *
 * **This is not the column's width.** A column carries its own width in its
 * view document's frontmatter (`board/columnWidth.ts`), because that describes
 * the *view* and travels with it. This describes the viewer. Dragging the body
 * wider therefore never widens the column: the column's own edge is the gesture
 * for that, and it already exists.
 */

export const DOC_WIDTH_STORAGE_KEY = "corpus.docWidth";

/**
 * Bumped when the shape below changes, or when the stylesheet's own default
 * measure moves — an older blob degrades to the default rather than pinning a
 * surface to a number that meant something else. Same stamp `threadCollapse`
 * carries, and for the same reason: a change re-asserts the default.
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
 * 30px gap, which is the grid `.focus-inner.with-margin` (FocusMode.css) and
 * `.reader-scroll.with-margin` (anchors.css) both declare.
 *
 * Subtracted from the room a drag may claim, so the pointer and the body's edge
 * stay together: without it the last 330px of a drag would move the pointer and
 * nothing else, and dragging back would do nothing until it re-crossed the
 * boundary — the dead zone that makes a resize feel broken.
 */
export const MARGIN_COLUMN_RESERVE = 330;

/**
 * How many surfaces one browser remembers.
 *
 * Columns are created and removed, and a width never expires on its own, so a
 * long-lived browser would otherwise accumulate one entry per column it has
 * ever held. The oldest go first, and losing one means that surface reads at
 * the default — the same thing a fresh browser sees.
 */
export const MAX_WIDTH_SURFACES = 100;

/** Every surface's chosen width, by surface key. */
export interface DocWidthState {
  readonly version: number;
  readonly surfaces: Readonly<Record<string, number>>;
}

export const EMPTY_DOC_WIDTH_STATE: DocWidthState = {
  version: DOC_WIDTH_STATE_VERSION,
  surfaces: {},
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
    const surfaces: Record<string, number> = {};
    const stored = record["surfaces"];
    if (typeof stored === "object" && stored !== null) {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          surfaces[key] = value;
        }
      }
    }
    return { version: DOC_WIDTH_STATE_VERSION, surfaces };
  } catch {
    return EMPTY_DOC_WIDTH_STATE;
  }
}

export function writeDocWidthState(
  state: DocWidthState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(DOC_WIDTH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded, or storage revoked mid-session. The surface keeps its
    // width for this session; it just will not survive a reload.
  }
}

/**
 * Forgets every chosen width.
 *
 * For the jsdom suites' `afterEach`: a width outlives a component and a
 * document by design, so without this one test's drag is the next one's
 * starting state. Nothing in the app calls it — there is no "forget my widths"
 * action, and §11 describes none.
 */
export function clearDocWidthState(storage: Storage | null = storageOrNull()): void {
  try {
    storage?.removeItem(DOC_WIDTH_STORAGE_KEY);
  } catch {
    // Same shrug as the writer's: there was nothing to clear.
  }
}

/**
 * One surface's chosen width, or `null` for "this surface has never been
 * dragged".
 *
 * `null` is not a number this module could supply: the default is the
 * stylesheet's `62ch` / `66ch`, which is font-dependent and therefore only the
 * browser knows it. Saying "nobody chose" is what lets the CSS keep owning the
 * default, which is the whole of *"a default is preserved for documents never
 * adjusted"*.
 */
export function surfaceWidth(state: DocWidthState, surfaceKey: string): number | null {
  return state.surfaces[surfaceKey] ?? null;
}

/**
 * The blob with one surface replaced — the only shape the writer ever takes.
 *
 * Re-inserted rather than updated in place so the key moves to the end of the
 * insertion order, which is what makes {@link MAX_WIDTH_SURFACES} drop the
 * least recently *chosen* rather than the least recently seen.
 */
export function withSurfaceWidth(
  state: DocWidthState,
  surfaceKey: string,
  width: number,
): DocWidthState {
  const surfaces: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.surfaces)) {
    if (key !== surfaceKey) surfaces[key] = value;
  }
  surfaces[surfaceKey] = width;
  const keys = Object.keys(surfaces);
  if (keys.length > MAX_WIDTH_SURFACES) {
    for (const key of keys.slice(0, keys.length - MAX_WIDTH_SURFACES)) {
      delete surfaces[key];
    }
  }
  return { version: DOC_WIDTH_STATE_VERSION, surfaces };
}
