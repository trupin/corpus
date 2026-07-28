import { useCallback, useMemo, useRef, useState } from "react";

/**
 * The browser-local half of the board, and **only** that half (SPEC.md §11).
 *
 * The dividing line is a correctness rule, not a preference: which columns
 * exist, what they query, what they are called and what order they sit in is
 * **corpus** state — it lives in view documents, is auto-committed, and is
 * identical in a second browser. Where you had scrolled and which document each
 * column had open is **local** — it is about this browser's session and belongs
 * to nobody else. Anything that ends up in the blob below and is not one of
 * those two things is a bug.
 */

export const BOARD_STORAGE_KEY = "corpus.board";

/** Bumped when the shape below changes; an older blob degrades to defaults. */
export const BOARD_STATE_VERSION = 1;

export interface ColumnLocalState {
  /** `scrollTop` of the column's list. */
  readonly scroll: number;
  /** The document id this column has open, or `null`. */
  readonly open: string | null;
}

export interface BoardLocalState {
  readonly version: number;
  readonly columns: Readonly<Record<string, ColumnLocalState>>;
}

export const EMPTY_BOARD_STATE: BoardLocalState = { version: BOARD_STATE_VERSION, columns: {} };

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and sandboxed frames throw on the property itself.
    return null;
  }
}

function readColumnState(value: unknown): ColumnLocalState | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const scroll = record["scroll"];
  const open = record["open"];
  return {
    scroll: typeof scroll === "number" && Number.isFinite(scroll) ? scroll : 0,
    open: typeof open === "string" ? open : null,
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
  readonly setOpen: (columnId: string, open: string | null) => void;
  /** Called with the live column ids whenever the column set changes. */
  readonly prune: (liveIds: readonly string[]) => void;
}

const DEFAULT_COLUMN_STATE: ColumnLocalState = { scroll: 0, open: null };

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
      if (next.scroll === current.scroll && next.open === current.open) return;
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

  const setOpen = useCallback(
    (columnId: string, open: string | null) => {
      patch(columnId, { open });
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
    () => ({ state, forColumn, setScroll, setOpen, prune }),
    [forColumn, prune, setOpen, setScroll, state],
  );
}
