import type { RevealTarget } from "@corpus/kit";

/**
 * The strip: one board's ordered sequence of query columns and paths, and the
 * navigation acts over it (SPEC.md §10, rider 3 — "a row opens a path").
 *
 * Everything here is **pure**: an act takes a {@link BoardStrip} and returns a
 * new one plus the column key to focus, and the component layer only commits the
 * result and scrolls. That split is what makes the loop rule ("no document
 * appears twice in one path") and the replacement rule ("picking a new row from
 * the origin replaces the whole path") testable without a DOM — the acts are the
 * contract `design/navigation.html` prototypes, ported onto the board's real
 * local state.
 *
 * **Paths are browser-local** (rider 3: "a board document never records them"),
 * so the strip *is* the board's slice of the `localStorage` blob — which is why
 * the query columns' scroll positions and navigation stacks live on the same
 * items: the strip replaced UI-148's per-column map as the one shape under
 * `boards[boardId]` (v4; see `useBoardLocalState`).
 */

/** One step of a reader's history: what was open, and where it was scrolled to. */
export interface NavEntry {
  readonly docId: string;
  /** `scrollTop` of the reader when navigation moved away from this entry. */
  readonly scrollY: number;
  /**
   * Where inside the document this open should land (UI-037) — a **pending
   * instruction**, not state: the reader honours it once the document has
   * rendered and then clears it from the entry. It rides the entry, and
   * therefore `localStorage`, because the instruction outlives the click that
   * made it.
   */
  readonly reveal?: RevealTarget | undefined;
}

/** A query column's browser-local half, exactly as UI-005/UI-148 shaped it. */
export interface QueryItem {
  readonly kind: "query";
  /** The board slot this column renders — `<viewId>` or `<viewId>#<n>`. */
  readonly view: string;
  /** `scrollTop` of the column's list. */
  readonly scroll: number;
  /** The in-place reader's navigation stack, deepest last (the "open here" reader). */
  readonly nav: readonly NavEntry[];
}

/** One reader column of a path. */
export interface PathCol {
  /** Its own navigation stack, deepest last. Never empty. */
  readonly stack: readonly NavEntry[];
  /** A width this browser chose for it, or absent for the 440px base. */
  readonly width?: number | undefined;
}

/**
 * What a path hangs off. `view` is a board slot id today; UI-150 will also pass
 * `"explorer"`, which no slot id can collide with (slots are document ids).
 */
export interface PathOrigin {
  readonly view: string;
  readonly doc: string;
}

/** A chain of reader columns hanging off an origin row — or off nothing. */
export interface PathItem {
  readonly kind: "path";
  /**
   * Unique within the board's blob (from {@link BoardStrip.seq}) — its own key
   * space, so a path column's key can never collide with a `<viewId>#<n>` slot.
   */
  readonly id: number;
  /** `null` is a **loose** path: no origin row, drawn with a solid border. */
  readonly origin: PathOrigin | null;
  readonly cols: readonly PathCol[];
}

export type StripItem = QueryItem | PathItem;

/** One board's browser-local half: its strip, and the next path id. */
export interface BoardStrip {
  readonly seq: number;
  readonly strip: readonly StripItem[];
}

export const EMPTY_BOARD_STRIP: BoardStrip = { seq: 1, strip: [] };

/** The base width of a path's reader columns — `design/navigation.html`'s `.pcol`. */
export const PATH_COLUMN_WIDTH = 440;

/* ── keys ─────────────────────────────────────────────────────────────── */

/**
 * The active-column key space is one namespace across both column kinds: a
 * query column's key is its slot id (unchanged from UI-148, which is what keeps
 * `data-col` selectors stable), and a path column's is `path:<id>:<idx>` —
 * a prefix no document id can carry (ids are `doc_…`/`th_…`, colon-free).
 */
export function pathColumnKey(pathId: number, index: number): string {
  return `path:${String(pathId)}:${String(index)}`;
}

export interface ParsedPathKey {
  readonly pathId: number;
  readonly index: number;
}

/** The path column a key names, or `null` for a query column's slot id. */
export function parsePathKey(key: string): ParsedPathKey | null {
  if (!key.startsWith("path:")) return null;
  const [, id, idx] = key.split(":");
  const pathId = Number(id);
  const index = Number(idx);
  if (!Number.isInteger(pathId) || !Number.isInteger(index) || index < 0) return null;
  return { pathId, index };
}

/* ── derivations ──────────────────────────────────────────────────────── */

export function pathsOf(board: BoardStrip): readonly PathItem[] {
  return board.strip.filter((item): item is PathItem => item.kind === "path");
}

/** The document a path column is showing — the top of its stack. */
export function topDoc(col: PathCol): string | null {
  return col.stack.at(-1)?.docId ?? null;
}

/** The documents a path's columns are showing, left to right. */
export function pathTops(path: PathItem): readonly string[] {
  return path.cols.map((col) => topDoc(col)).filter((id): id is string => id !== null);
}

/** How many reader columns the board's paths hold, across every path. */
export function pathColumnCount(board: BoardStrip): number {
  return pathsOf(board).reduce((sum, path) => sum + path.cols.length, 0);
}

/**
 * The path hanging off this query column, if one is: the first path after the
 * column's item and before the next query item whose origin names the view.
 */
export function pathOffView(board: BoardStrip, view: string): PathItem | null {
  const at = board.strip.findIndex((item) => item.kind === "query" && item.view === view);
  if (at < 0) return null;
  for (let index = at + 1; index < board.strip.length; index += 1) {
    const item = board.strip[index];
    if (item === undefined || item.kind !== "path") break;
    if (item.origin !== null && item.origin.view === view) return item;
  }
  return null;
}

/** The document whose row carries `.origin` in this column, or `null`. */
export function originDocOf(board: BoardStrip, view: string): string | null {
  return pathOffView(board, view)?.origin?.doc ?? null;
}

/**
 * Every document open on the board — the top of each query column's in-place
 * reader and of each path column. What marks a row "open elsewhere" (the dot)
 * and, later, the explorer's tree.
 */
export function openDocsOn(board: BoardStrip): ReadonlySet<string> {
  const open = new Set<string>();
  for (const item of board.strip) {
    if (item.kind === "query") {
      const top = item.nav.at(-1)?.docId;
      if (top !== undefined) open.add(top);
    } else {
      for (const doc of pathTops(item)) open.add(doc);
    }
  }
  return open;
}

/** The document a column key is showing, or `null` (a list, or nothing). */
export function docAtKey(board: BoardStrip, key: string): string | null {
  const parsed = parsePathKey(key);
  if (parsed === null) {
    const item = board.strip.find((entry) => entry.kind === "query" && entry.view === key);
    return item?.kind === "query" ? (item.nav.at(-1)?.docId ?? null) : null;
  }
  const path = pathsOf(board).find((entry) => entry.id === parsed.pathId);
  const col = path?.cols[parsed.index];
  return col === undefined ? null : topDoc(col);
}

/* ── reconciliation ───────────────────────────────────────────────────── */

/**
 * Query items follow the board document's column order; paths keep their place
 * relative to the query item before them (the prototype's `boardState`).
 *
 * A path whose anchoring column left the board re-anchors to the nearest
 * surviving column on its left, or to the left edge — it is **not** closed,
 * which is the user's 2026-08-22 decision about an origin row leaving its
 * column: the path stays where it is.
 *
 * Returns the same object when nothing changed, so callers can commit on
 * identity.
 */
export function reconcileStrip(board: BoardStrip, liveViews: readonly string[]): BoardStrip {
  const groups = new Map<string | null, PathItem[]>();
  groups.set(null, []);
  let current: string | null = null;
  for (const item of board.strip) {
    if (item.kind === "query") {
      if (liveViews.includes(item.view)) {
        current = item.view;
        if (!groups.has(current)) groups.set(current, []);
      }
      continue;
    }
    (groups.get(current) ?? groups.get(null))?.push(item);
  }

  const next: StripItem[] = [...(groups.get(null) ?? [])];
  for (const view of liveViews) {
    const old = board.strip.find(
      (item): item is QueryItem => item.kind === "query" && item.view === view,
    );
    next.push(old ?? { kind: "query", view, scroll: 0, nav: [] });
    next.push(...(groups.get(view) ?? []));
  }

  const unchanged =
    next.length === board.strip.length && next.every((item, index) => item === board.strip[index]);
  return unchanged ? board : { seq: board.seq, strip: next };
}

/* ── acts ─────────────────────────────────────────────────────────────── */

/** What an act did, and where the board should look afterwards. */
export interface StripResult {
  readonly board: BoardStrip;
  /** The column key to activate, scroll in and flash — or `null`. */
  readonly focus: string | null;
  /**
   * The loop rule fired: the document was already in the path, its column is
   * {@link focus}, and nothing was closed. The caller centres and toasts.
   */
  readonly recentred: boolean;
}

function rootEntry(docId: string, reveal?: RevealTarget): NavEntry {
  return reveal === undefined ? { docId, scrollY: 0 } : { docId, scrollY: 0, reveal };
}

function replaceItem(board: BoardStrip, from: StripItem, to: StripItem): BoardStrip {
  return { seq: board.seq, strip: board.strip.map((item) => (item === from ? to : item)) };
}

/** The loop rule, shared: the column already showing `docId`, or `null`. */
function recentreKey(path: PathItem, docId: string): string | null {
  const at = pathTops(path).indexOf(docId);
  return at < 0 ? null : pathColumnKey(path.id, at);
}

/**
 * Open from a row of a query column: a path hangs off that row (rider 3).
 * A second pick from the same column **replaces** the whole path; picking a
 * document the path already shows re-centres instead (the loop rule).
 */
export function openFromView(
  board: BoardStrip,
  view: string,
  docId: string,
  reveal?: RevealTarget,
): StripResult {
  const existing = pathOffView(board, view);
  if (existing !== null) {
    const already = recentreKey(existing, docId);
    if (already !== null) return { board, focus: already, recentred: true };
    const replaced: PathItem = {
      ...existing,
      origin: { view, doc: docId },
      cols: [{ stack: [rootEntry(docId, reveal)] }],
    };
    return {
      board: replaceItem(board, existing, replaced),
      focus: pathColumnKey(existing.id, 0),
      recentred: false,
    };
  }

  const at = board.strip.findIndex((item) => item.kind === "query" && item.view === view);
  if (at < 0) return openLoose(board, docId, reveal);
  const path: PathItem = {
    kind: "path",
    id: board.seq,
    origin: { view, doc: docId },
    cols: [{ stack: [rootEntry(docId, reveal)] }],
  };
  const strip = [...board.strip];
  strip.splice(at + 1, 0, path);
  return {
    board: { seq: board.seq + 1, strip },
    focus: pathColumnKey(path.id, 0),
    recentred: false,
  };
}

/**
 * A link followed inside a path column: the path continues to the right,
 * truncating whatever was after that column (rider 3). `fromScrollY`, when
 * given, is stamped onto the column being left so Back restores it exactly.
 */
export function openFromPath(
  board: BoardStrip,
  pathId: number,
  index: number,
  docId: string,
  options: { readonly reveal?: RevealTarget | undefined; readonly fromScrollY?: number } = {},
): StripResult {
  const path = pathsOf(board).find((item) => item.id === pathId);
  if (path === undefined) return { board, focus: null, recentred: false };
  const already = recentreKey(path, docId);
  if (already !== null) return { board, focus: already, recentred: true };

  const kept = path.cols.slice(0, index + 1).map((col, at) => {
    if (at !== index || options.fromScrollY === undefined) return col;
    const top = col.stack.at(-1);
    if (top === undefined) return col;
    return {
      ...col,
      stack: [...col.stack.slice(0, -1), { docId: top.docId, scrollY: options.fromScrollY }],
    };
  });
  const next: PathItem = {
    ...path,
    cols: [...kept, { stack: [rootEntry(docId, options.reveal)] }],
  };
  return {
    board: replaceItem(board, path, next),
    focus: pathColumnKey(pathId, index + 1),
    recentred: false,
  };
}

/**
 * "Open here" inside a path column (`⌥↵`, the row menu's phrase): navigates the
 * column in place — a push onto its own stack — and truncates the path to its
 * right, because everything after it continued from what it used to show. The
 * loop rule applies here too.
 *
 * The query-column form of "open here" is not here: it is the reader the column
 * always had, and the board pushes onto that column's nav directly (rider 3:
 * "the existing reader inside a query column, unchanged").
 */
export function openHereInPath(
  board: BoardStrip,
  pathId: number,
  index: number,
  docId: string,
  reveal?: RevealTarget,
): StripResult {
  const path = pathsOf(board).find((item) => item.id === pathId);
  if (path === undefined) return { board, focus: null, recentred: false };
  const already = recentreKey(path, docId);
  if (already !== null) return { board, focus: already, recentred: true };
  const col = path.cols[index];
  if (col === undefined) return { board, focus: null, recentred: false };
  const next: PathItem = {
    ...path,
    cols: [
      ...path.cols.slice(0, index),
      { ...col, stack: [...col.stack, rootEntry(docId, reveal)] },
    ],
  };
  return {
    board: replaceItem(board, path, next),
    focus: pathColumnKey(pathId, index),
    recentred: false,
  };
}

/**
 * An open with no origin — the search overlay's `↵`, the console's `↗ open`, a
 * link inside full screen, "open in" another board: a **loose path at the left
 * edge** of the board (rider 3). A document already showing in one of this
 * board's paths re-centres instead.
 */
export function openLoose(board: BoardStrip, docId: string, reveal?: RevealTarget): StripResult {
  for (const path of pathsOf(board)) {
    const already = recentreKey(path, docId);
    if (already !== null) return { board, focus: already, recentred: true };
  }
  const path: PathItem = {
    kind: "path",
    id: board.seq,
    origin: null,
    cols: [{ stack: [rootEntry(docId, reveal)] }],
  };
  return {
    board: { seq: board.seq + 1, strip: [path, ...board.strip] },
    focus: pathColumnKey(path.id, 0),
    recentred: false,
  };
}

/**
 * Restart the path here: the path closes and this column's document becomes the
 * root of a loose path in the same place (rider 3).
 */
export function restartPathHere(board: BoardStrip, pathId: number, index: number): StripResult {
  const path = pathsOf(board).find((item) => item.id === pathId);
  const doc = path?.cols[index] === undefined ? null : topDoc(path.cols[index]);
  if (path === undefined || doc === null) return { board, focus: null, recentred: false };
  const next: PathItem = { ...path, origin: null, cols: [{ stack: [rootEntry(doc)] }] };
  return {
    board: replaceItem(board, path, next),
    focus: pathColumnKey(pathId, 0),
    recentred: false,
  };
}

/** A new loose path directly right of this one, rooted at this column's document. */
export function newPathRight(board: BoardStrip, pathId: number, index: number): StripResult {
  const at = board.strip.findIndex((item) => item.kind === "path" && item.id === pathId);
  const path = board.strip[at];
  if (at < 0 || path === undefined || path.kind !== "path") {
    return { board, focus: null, recentred: false };
  }
  const doc = path.cols[index] === undefined ? null : topDoc(path.cols[index]);
  if (doc === null) return { board, focus: null, recentred: false };
  const fresh: PathItem = {
    kind: "path",
    id: board.seq,
    origin: null,
    cols: [{ stack: [rootEntry(doc)] }],
  };
  const strip = [...board.strip];
  strip.splice(at + 1, 0, fresh);
  return {
    board: { seq: board.seq + 1, strip },
    focus: pathColumnKey(fresh.id, 0),
    recentred: false,
  };
}

/**
 * Keep — detach from its origin: the path stays, loose; the next pick from its
 * origin row's column opens a new one.
 */
export function detachPath(board: BoardStrip, pathId: number): BoardStrip {
  const path = pathsOf(board).find((item) => item.id === pathId);
  if (path === undefined || path.origin === null) return board;
  return replaceItem(board, path, { ...path, origin: null });
}

/** The key of the column left of a strip position, for focus after a close. */
function neighbourKey(strip: readonly StripItem[], at: number): string | null {
  for (let index = at - 1; index >= 0; index -= 1) {
    const item = strip[index];
    if (item === undefined) continue;
    if (item.kind === "query") return item.view;
    return pathColumnKey(item.id, item.cols.length - 1);
  }
  const first = strip[at] ?? strip[0];
  if (first === undefined) return null;
  return first.kind === "query" ? first.view : pathColumnKey(first.id, 0);
}

/** Close this column and everything after it; closing the first closes the path. */
export function closeCol(board: BoardStrip, pathId: number, index: number): StripResult {
  const at = board.strip.findIndex((item) => item.kind === "path" && item.id === pathId);
  const path = board.strip[at];
  if (at < 0 || path === undefined || path.kind !== "path") {
    return { board, focus: null, recentred: false };
  }
  if (index === 0) {
    const strip = board.strip.filter((item) => item !== path);
    return {
      board: { seq: board.seq, strip },
      focus: neighbourKey(board.strip, at),
      recentred: false,
    };
  }
  const next: PathItem = { ...path, cols: path.cols.slice(0, index) };
  return {
    board: replaceItem(board, path, next),
    focus: pathColumnKey(pathId, index - 1),
    recentred: false,
  };
}

/** Close the whole path — the first column's close. */
export function closeWholePath(board: BoardStrip, pathId: number): StripResult {
  return closeCol(board, pathId, 0);
}

export interface CloseAllResult {
  readonly board: BoardStrip;
  readonly focus: string | null;
  /** How many paths went — the toast's count. `0` means nothing changed. */
  readonly closed: number;
}

/** Close every path on this board — one act, from the bar or `⇧esc` (rider 3). */
export function closeAllPaths(board: BoardStrip): CloseAllResult {
  const closed = pathsOf(board).length;
  if (closed === 0) return { board, focus: null, closed };
  const strip = board.strip.filter((item) => item.kind === "query");
  const first = strip[0];
  return {
    board: { seq: board.seq, strip },
    focus: first !== undefined && first.kind === "query" ? first.view : null,
    closed,
  };
}

/**
 * The bridge from a path column's mounted `Reader` back onto the strip: the
 * reader replaces its stack (scroll capture, reveal consumption, Back, the
 * abandonment rule), and the strip decides what that means for the path.
 *
 * - Empty: the column's history is exhausted — the column closes, and
 *   everything after it goes with it (the prototype's `back`).
 * - Shorter: Back — the stack pops **and the path truncates to this column**,
 *   because what followed continued from the entry that just left.
 * - Same length (or longer, defensively): an in-place rewrite — scroll capture
 *   or a consumed reveal — which changes no geometry.
 */
export function setPathColStack(
  board: BoardStrip,
  pathId: number,
  index: number,
  stack: readonly NavEntry[],
): StripResult {
  const path = pathsOf(board).find((item) => item.id === pathId);
  const col = path?.cols[index];
  if (path === undefined || col === undefined) return { board, focus: null, recentred: false };
  if (stack.length === 0) return closeCol(board, pathId, index);
  if (stack.length < col.stack.length) {
    const next: PathItem = {
      ...path,
      cols: [...path.cols.slice(0, index), { ...col, stack }],
    };
    return {
      board: replaceItem(board, path, next),
      focus: pathColumnKey(pathId, index),
      recentred: false,
    };
  }
  const next: PathItem = {
    ...path,
    cols: path.cols.map((entry, at) => (at === index ? { ...entry, stack } : entry)),
  };
  return { board: replaceItem(board, path, next), focus: null, recentred: false };
}

/** A width this browser chose for one path column (§10's width rule, local here). */
export function setPathColWidth(
  board: BoardStrip,
  pathId: number,
  index: number,
  width: number,
): BoardStrip {
  const path = pathsOf(board).find((item) => item.id === pathId);
  const col = path?.cols[index];
  if (path === undefined || col === undefined) return board;
  const next: PathItem = {
    ...path,
    cols: path.cols.map((entry, at) => (at === index ? { ...entry, width } : entry)),
  };
  return replaceItem(board, path, next);
}

/* ── parsing (the localStorage blob's strip half) ─────────────────────── */

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A stored reveal, or `null` for anything that is not one. An unrecognised
 * instruction is dropped, not repaired: the cost is an open that lands at the
 * top of the document; the cost of guessing is a flash over text the user never
 * pointed at.
 */
function readReveal(value: unknown): RevealTarget | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "thread") {
    const threadId = optionalString(record["threadId"]);
    return threadId === undefined ? null : { kind: "thread", threadId };
  }
  if (record["kind"] !== "item") return null;
  const exact = optionalString(record["exact"]);
  if (exact === undefined) return null;
  const prefix = optionalString(record["prefix"]);
  const suffix = optionalString(record["suffix"]);
  return {
    kind: "item",
    exact,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}

function readNavEntry(value: unknown): NavEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const docId = record["docId"];
  if (typeof docId !== "string" || docId === "") return null;
  const scrollY = record["scrollY"];
  const reveal = readReveal(record["reveal"]);
  return {
    docId,
    scrollY: typeof scrollY === "number" && Number.isFinite(scrollY) ? scrollY : 0,
    ...(reveal === null ? {} : { reveal }),
  };
}

function readStack(value: unknown): NavEntry[] {
  const stack: NavEntry[] = [];
  if (!Array.isArray(value)) return stack;
  for (const entry of value) {
    const parsed = readNavEntry(entry);
    if (parsed !== null) stack.push(parsed);
  }
  return stack;
}

function readPathCol(value: unknown): PathCol | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const stack = readStack(record["stack"]);
  if (stack.length === 0) return null;
  const width = record["width"];
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? { stack, width }
    : { stack };
}

function readStripItem(value: unknown): StripItem | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "query") {
    const view = optionalString(record["view"]);
    if (view === undefined) return null;
    const scroll = record["scroll"];
    return {
      kind: "query",
      view,
      scroll: typeof scroll === "number" && Number.isFinite(scroll) ? scroll : 0,
      nav: readStack(record["nav"]),
    };
  }
  if (record["kind"] !== "path") return null;
  const id = record["id"];
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  const cols: PathCol[] = [];
  if (Array.isArray(record["cols"])) {
    for (const entry of record["cols"]) {
      const col = readPathCol(entry);
      if (col !== null) cols.push(col);
    }
  }
  // A path with no columns is nothing — it is dropped rather than drawn empty.
  if (cols.length === 0) return null;
  const origin = record["origin"];
  let parsedOrigin: PathOrigin | null = null;
  if (typeof origin === "object" && origin !== null) {
    const view = optionalString((origin as Record<string, unknown>)["view"]);
    const doc = optionalString((origin as Record<string, unknown>)["doc"]);
    if (view !== undefined && doc !== undefined) parsedOrigin = { view, doc };
  }
  return { kind: "path", id, origin: parsedOrigin, cols };
}

/**
 * One board's stored strip, defensively. Anything unrecognised reads as absent:
 * losing a path to a hand-edited blob is a shrug; throwing here is a blank
 * board (`useBoardLocalState`'s standing rule).
 */
export function readBoardStrip(value: unknown): BoardStrip {
  if (typeof value !== "object" || value === null) return EMPTY_BOARD_STRIP;
  const record = value as Record<string, unknown>;
  const strip: StripItem[] = [];
  if (Array.isArray(record["strip"])) {
    for (const entry of record["strip"]) {
      const item = readStripItem(entry);
      if (item !== null) strip.push(item);
    }
  }
  const seq = record["seq"];
  const highest = strip.reduce(
    (max, item) => (item.kind === "path" ? Math.max(max, item.id + 1) : max),
    1,
  );
  return {
    // `seq` must clear every stored path id, or a restored blob would mint a
    // duplicate key; a missing or damaged seq re-derives from the paths.
    seq: typeof seq === "number" && Number.isInteger(seq) && seq >= highest ? seq : highest,
    strip,
  };
}
