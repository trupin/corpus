import type { RevealTarget } from "@corpus/kit/plugin";
import { useCallback, useMemo, useRef, useState } from "react";

/**
 * The browser-local half of the board, and **only** that half (SPEC.md §10).
 *
 * The dividing line is a correctness rule, not a preference: which columns
 * exist, what they query, what they are called and what order they sit in is
 * **corpus** state — it lives in view documents, is auto-committed, and is
 * identical in a second browser. Where you had scrolled, which document each
 * column had open, and how you got there is **local** — it is about this
 * browser's session and belongs to nobody else. Anything that ends up in the
 * blob below and is not one of those things is a bug.
 */

export const BOARD_STORAGE_KEY = "corpus.board";

/**
 * Bumped when the shape below changes; an older blob degrades to defaults.
 *
 * **2** — UI-005 replaced `open: string | null` with the navigation stack
 * SPEC.md §10 requires ("each reader keeps its own navigation stack … Back pops
 * with scroll position restored"). A single open id cannot express a stack, and
 * every v1 blob is discarded on first load: the cost is one lost scroll position
 * per column, which is the right trade against migrating a shape whose whole
 * purpose is to be disposable.
 */
export const BOARD_STATE_VERSION = 2;

/** One step of a reader's history: what was open, and where it was scrolled to. */
export interface NavEntry {
  readonly docId: string;
  /** `scrollTop` of the reader when navigation moved away from this entry. */
  readonly scrollY: number;
  /**
   * Where inside the document this open should land (UI-037) — a **pending
   * instruction**, not state: the reader honours it once the document has
   * rendered and then clears it from the entry, which is what keeps Back from
   * re-flashing something the user has already been shown.
   *
   * It rides the entry, and therefore `localStorage`, because the instruction
   * outlives the click that made it: the document is not on screen yet when the
   * open happens, and a reload in that window should still land where the user
   * asked rather than at the top of the document.
   */
  readonly reveal?: RevealTarget | undefined;
}

export interface ColumnLocalState {
  /** `scrollTop` of the column's list. */
  readonly scroll: number;
  /** The reader's navigation stack, deepest last. Empty means the list is showing. */
  readonly nav: readonly NavEntry[];
}

export interface BoardLocalState {
  readonly version: number;
  readonly columns: Readonly<Record<string, ColumnLocalState>>;
}

export const EMPTY_BOARD_STATE: BoardLocalState = { version: BOARD_STATE_VERSION, columns: {} };

/** The document a column is showing, or `null` when it is showing its list. */
export function openDocId(state: ColumnLocalState): string | null {
  return state.nav.at(-1)?.docId ?? null;
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and sandboxed frames throw on the property itself.
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A stored reveal, or `null` for anything that is not one.
 *
 * Same rule as the blob around it: an unrecognised instruction is dropped, not
 * repaired. The cost is an open that lands at the top of the document; the cost
 * of guessing is a flash over text the user never pointed at.
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

function readColumnState(value: unknown): ColumnLocalState | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const scroll = record["scroll"];
  const stored = record["nav"];
  const nav: NavEntry[] = [];
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      const parsed = readNavEntry(entry);
      if (parsed !== null) nav.push(parsed);
    }
  }
  return {
    scroll: typeof scroll === "number" && Number.isFinite(scroll) ? scroll : 0,
    nav,
  };
}

/**
 * Anything unrecognised — garbage, a blob from an older version, a hand-edited
 * value — reads as "no local state". Losing a scroll position is a shrug;
 * throwing here is a blank board.
 */
export function readBoardLocalState(storage: Storage | null = storageOrNull()): BoardLocalState {
  if (storage === null) return EMPTY_BOARD_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(BOARD_STORAGE_KEY);
  } catch {
    return EMPTY_BOARD_STATE;
  }
  if (raw === null) return EMPTY_BOARD_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_BOARD_STATE;
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== BOARD_STATE_VERSION) return EMPTY_BOARD_STATE;
    const columns: Record<string, ColumnLocalState> = {};
    const stored = record["columns"];
    if (typeof stored === "object" && stored !== null) {
      for (const [id, value] of Object.entries(stored)) {
        const column = readColumnState(value);
        if (column !== null) columns[id] = column;
      }
    }
    return { version: BOARD_STATE_VERSION, columns };
  } catch {
    return EMPTY_BOARD_STATE;
  }
}

export function writeBoardLocalState(
  state: BoardLocalState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(BOARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded, or storage revoked mid-session. The board keeps the state
    // in memory for this session; it just will not survive a reload.
  }
}

/** Drops entries for columns that no longer exist — an archived view, say. */
export function pruneColumns(state: BoardLocalState, liveIds: readonly string[]): BoardLocalState {
  const live = new Set(liveIds);
  const columns: Record<string, ColumnLocalState> = {};
  let dropped = false;
  for (const [id, column] of Object.entries(state.columns)) {
    if (live.has(id)) columns[id] = column;
    else dropped = true;
  }
  return dropped ? { version: state.version, columns } : state;
}

export interface BoardLocalStateApi {
  readonly state: BoardLocalState;
  readonly forColumn: (columnId: string) => ColumnLocalState;
  readonly setScroll: (columnId: string, scroll: number) => void;
  /** Replaces a column's navigation stack; `[]` closes the reader. */
  readonly setNav: (columnId: string, nav: readonly NavEntry[]) => void;
  /** Called with the live column ids whenever the column set changes. */
  readonly prune: (liveIds: readonly string[]) => void;
}

const DEFAULT_COLUMN_STATE: ColumnLocalState = { scroll: 0, nav: [] };

/**
 * Compared field by field rather than by identity, because the difference that
 * matters most is a reveal **disappearing**: the reader clears the instruction
 * the moment it honours it, and a comparison that ignored the field would call
 * that a no-op write and leave the reveal in storage to fire again on reload.
 */
function sameReveal(left: RevealTarget | undefined, right: RevealTarget | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.kind === "item" && right.kind === "item") {
    return (
      left.exact === right.exact && left.prefix === right.prefix && left.suffix === right.suffix
    );
  }
  if (left.kind === "thread" && right.kind === "thread") return left.threadId === right.threadId;
  return false;
}

function sameNav(left: readonly NavEntry[], right: readonly NavEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.docId === other.docId &&
      entry.scrollY === other.scrollY &&
      sameReveal(entry.reveal, other.reveal)
    );
  });
}

export function useBoardLocalState(): BoardLocalStateApi {
  const [state, setState] = useState<BoardLocalState>(() => readBoardLocalState());
  // Scroll events fire constantly; a ref lets the writer read the latest state
  // without every column re-subscribing on each pixel.
  const latest = useRef(state);
  latest.current = state;

  const commit = useCallback((next: BoardLocalState) => {
    latest.current = next;
    setState(next);
    writeBoardLocalState(next);
  }, []);

  const patch = useCallback(
    (columnId: string, change: Partial<ColumnLocalState>) => {
      const current = latest.current.columns[columnId] ?? DEFAULT_COLUMN_STATE;
      const next = { ...current, ...change };
      if (next.scroll === current.scroll && sameNav(next.nav, current.nav)) return;
      commit({
        version: BOARD_STATE_VERSION,
        columns: { ...latest.current.columns, [columnId]: next },
      });
    },
    [commit],
  );

  const setScroll = useCallback(
    (columnId: string, scroll: number) => {
      patch(columnId, { scroll });
    },
    [patch],
  );

  const setNav = useCallback(
    (columnId: string, nav: readonly NavEntry[]) => {
      patch(columnId, { nav });
    },
    [patch],
  );

  const prune = useCallback(
    (liveIds: readonly string[]) => {
      const next = pruneColumns(latest.current, liveIds);
      if (next !== latest.current) commit(next);
    },
    [commit],
  );

  const forColumn = useCallback(
    (columnId: string) => state.columns[columnId] ?? DEFAULT_COLUMN_STATE,
    [state],
  );

  return useMemo(
    () => ({ state, forColumn, setScroll, setNav, prune }),
    [forColumn, prune, setNav, setScroll, state],
  );
}
