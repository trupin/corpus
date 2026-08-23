import { useCallback, useMemo, useRef, useState } from "react";
import {
  EMPTY_BOARD_STRIP,
  readBoardStrip,
  reconcileStrip,
  type BoardStrip,
  type NavEntry,
  type QueryItem,
} from "./strip";

/**
 * The browser-local half of the board, and **only** that half (SPEC.md §10).
 *
 * The dividing line is a correctness rule, not a preference: which boards exist,
 * which columns each one holds, what they query, what they are called and what
 * order they sit in is **corpus** state — it lives in board and view documents,
 * is auto-committed, and is identical in a second browser. Where you had
 * scrolled, which document each column had open, **which paths hang off which
 * rows** (SPEC.md §10, rider 3: "paths are browser-local, like navigation
 * stacks; a board document never records them"), and which board you are
 * looking at is **local**. Anything that ends up in the blob below and is not
 * one of those things is a bug.
 */

export type { NavEntry };

export const BOARD_STORAGE_KEY = "corpus.board";

/**
 * Bumped when the shape below changes; an older blob degrades to defaults.
 *
 * **2** — UI-005 replaced `open: string | null` with the navigation stack.
 * **3** — UI-148 nested the column map under the board and added `board`.
 * **4** — UI-149 replaced each board's column map with its **strip**: an
 * ordered list of query columns and paths (`strip.ts`), because a map keyed by
 * slot id cannot say where a path sits between two columns. Every v3 blob is
 * discarded on first load — the established precedent, at the established
 * cost of one scroll position per column.
 */
export const BOARD_STATE_VERSION = 4;

export interface ColumnLocalState {
  /** `scrollTop` of the column's list. */
  readonly scroll: number;
  /** The reader's navigation stack, deepest last. Empty means the list is showing. */
  readonly nav: readonly NavEntry[];
}

export interface BoardLocalState {
  readonly version: number;
  /**
   * The board this browser last chose, or `null` for a browser that has never
   * chosen one — which is what makes `default-open` the answer on a first load
   * (SPEC.md §10, rider 2 as amended). Nothing writes it except an explicit act.
   */
  readonly board: string | null;
  readonly boards: Readonly<Record<string, BoardStrip>>;
}

export const EMPTY_BOARD_STATE: BoardLocalState = {
  version: BOARD_STATE_VERSION,
  board: null,
  boards: {},
};

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
    const boards: Record<string, BoardStrip> = {};
    const storedBoards = record["boards"];
    if (typeof storedBoards === "object" && storedBoards !== null) {
      for (const [boardId, value] of Object.entries(storedBoards)) {
        boards[boardId] = readBoardStrip(value);
      }
    }
    const board = record["board"];
    return {
      version: BOARD_STATE_VERSION,
      board: typeof board === "string" && board !== "" ? board : null,
      boards,
    };
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

/**
 * Drops every board that no longer exists — an archived one, one the agent
 * deleted. The **chosen** board is left alone: it is checked against the live
 * list on every render anyway (`resolveBoard`), and clearing it here would turn
 * a board that is merely still loading into a browser that never chose one.
 */
export function pruneBoards(
  state: BoardLocalState,
  liveBoardIds: readonly string[],
): BoardLocalState {
  const live = new Set(liveBoardIds);
  const boards: Record<string, BoardStrip> = {};
  let dropped = false;
  for (const [id, board] of Object.entries(state.boards)) {
    if (live.has(id)) boards[id] = board;
    else dropped = true;
  }
  return dropped ? { ...state, boards } : state;
}

/**
 * The whole blob, addressed by board — what the hook returns.
 *
 * Board-addressed rather than bound to one board at construction, because which
 * board is showing is itself derived from `chosenBoard`, and because "open in
 * another board" writes a path into a strip that is not the showing one.
 */
export interface BoardLocalStore {
  readonly state: BoardLocalState;
  /** The board this browser last explicitly chose, or `null`. */
  readonly chosenBoard: string | null;
  /** Records an explicit choice of board. Nothing else writes it. */
  readonly chooseBoard: (boardId: string) => void;
  /** One board's strip — `EMPTY_BOARD_STRIP` for a board never touched. */
  readonly stripOf: (boardId: string) => BoardStrip;
  /** Replaces one board's strip; identical input is a no-op write. */
  readonly commitStrip: (boardId: string, next: BoardStrip) => void;
  readonly forColumn: (boardId: string, columnId: string) => ColumnLocalState;
  readonly setScroll: (boardId: string, columnId: string, scroll: number) => void;
  /** Replaces a query column's navigation stack; `[]` closes the reader. */
  readonly setNav: (boardId: string, columnId: string, nav: readonly NavEntry[]) => void;
  /** Reconciles a board's strip against its live column slots. */
  readonly reconcile: (boardId: string, liveIds: readonly string[]) => void;
  /** Called with the live board ids whenever the board set changes. */
  readonly pruneBoardSet: (liveBoardIds: readonly string[]) => void;
}

/** One board's slice of {@link BoardLocalStore} — what the board itself uses. */
export interface BoardLocalStateApi {
  /** The bound board's strip, as stored right now. */
  readonly strip: BoardStrip;
  /** Commits a strip act's result for the bound board. */
  readonly commitStrip: (next: BoardStrip) => void;
  readonly forColumn: (columnId: string) => ColumnLocalState;
  readonly setScroll: (columnId: string, scroll: number) => void;
  readonly setNav: (columnId: string, nav: readonly NavEntry[]) => void;
  readonly prune: (liveIds: readonly string[]) => void;
}

const DEFAULT_COLUMN_STATE: ColumnLocalState = { scroll: 0, nav: [] };

function queryItem(board: BoardStrip, columnId: string): QueryItem | undefined {
  return board.strip.find(
    (item): item is QueryItem => item.kind === "query" && item.view === columnId,
  );
}

/** A query column's local half out of the strip — the UI-148 shape, preserved. */
export function columnStateOf(board: BoardStrip, columnId: string): ColumnLocalState {
  const item = queryItem(board, columnId);
  return item === undefined ? DEFAULT_COLUMN_STATE : { scroll: item.scroll, nav: item.nav };
}

/**
 * Writes one query column's local half back into the strip, appending the item
 * when the strip has not met this column yet — reconciliation orders it on the
 * next pass, and losing the first scroll of a brand-new column to ordering
 * would be worse than holding it at the end for a frame.
 */
export function withColumnState(
  board: BoardStrip,
  columnId: string,
  change: Partial<ColumnLocalState>,
): BoardStrip {
  const existing = queryItem(board, columnId);
  if (existing === undefined) {
    const fresh: QueryItem = {
      kind: "query",
      view: columnId,
      scroll: change.scroll ?? 0,
      nav: change.nav ?? [],
    };
    return { seq: board.seq, strip: [...board.strip, fresh] };
  }
  const next: QueryItem = {
    ...existing,
    ...(change.scroll === undefined ? {} : { scroll: change.scroll }),
    ...(change.nav === undefined ? {} : { nav: change.nav }),
  };
  return {
    seq: board.seq,
    strip: board.strip.map((item) => (item === existing ? next : item)),
  };
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
      // Compared field by field: a reveal **disappearing** (consumed by the
      // reader) must count as a change, or it would survive in storage and
      // re-fire on every reload.
      sameReveal(entry.reveal, other.reveal)
    );
  });
}

function sameReveal(
  left: NavEntry["reveal"] | undefined,
  right: NavEntry["reveal"] | undefined,
): boolean {
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

export function useBoardLocalState(): BoardLocalStore {
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

  const commitStrip = useCallback(
    (boardId: string, next: BoardStrip) => {
      const current = latest.current.boards[boardId] ?? EMPTY_BOARD_STRIP;
      if (next === current) return;
      commit({
        ...latest.current,
        version: BOARD_STATE_VERSION,
        boards: { ...latest.current.boards, [boardId]: next },
      });
    },
    [commit],
  );

  const patch = useCallback(
    (boardId: string, columnId: string, change: Partial<ColumnLocalState>) => {
      const board = latest.current.boards[boardId] ?? EMPTY_BOARD_STRIP;
      const current = columnStateOf(board, columnId);
      const scroll = change.scroll ?? current.scroll;
      const nav = change.nav ?? current.nav;
      if (scroll === current.scroll && sameNav(nav, current.nav)) return;
      commitStrip(boardId, withColumnState(board, columnId, change));
    },
    [commitStrip],
  );

  const setScroll = useCallback(
    (boardId: string, columnId: string, scroll: number) => {
      patch(boardId, columnId, { scroll });
    },
    [patch],
  );

  const setNav = useCallback(
    (boardId: string, columnId: string, nav: readonly NavEntry[]) => {
      patch(boardId, columnId, { nav });
    },
    [patch],
  );

  const reconcile = useCallback(
    (boardId: string, liveIds: readonly string[]) => {
      const board = latest.current.boards[boardId] ?? EMPTY_BOARD_STRIP;
      commitStrip(boardId, reconcileStrip(board, liveIds));
    },
    [commitStrip],
  );

  const pruneBoardSet = useCallback(
    (liveBoardIds: readonly string[]) => {
      const next = pruneBoards(latest.current, liveBoardIds);
      if (next !== latest.current) commit(next);
    },
    [commit],
  );

  const chooseBoard = useCallback(
    (chosen: string) => {
      if (latest.current.board === chosen) return;
      commit({ ...latest.current, version: BOARD_STATE_VERSION, board: chosen });
    },
    [commit],
  );

  const stripOf = useCallback(
    (boardId: string) => state.boards[boardId] ?? EMPTY_BOARD_STRIP,
    [state],
  );

  const forColumn = useCallback(
    (boardId: string, columnId: string) =>
      columnStateOf(state.boards[boardId] ?? EMPTY_BOARD_STRIP, columnId),
    [state],
  );

  return useMemo(
    () => ({
      state,
      chosenBoard: state.board,
      chooseBoard,
      stripOf,
      commitStrip,
      forColumn,
      setScroll,
      setNav,
      reconcile,
      pruneBoardSet,
    }),
    [
      chooseBoard,
      commitStrip,
      forColumn,
      pruneBoardSet,
      reconcile,
      setNav,
      setScroll,
      state,
      stripOf,
    ],
  );
}

/**
 * One board's slice, for the board that is showing.
 *
 * `null` — no board at all — answers with defaults and swallows every write,
 * which is the right shape for a workspace that never ran the migration: the
 * board renders nothing, so nothing can be scrolled or opened in it.
 */
export function bindBoardLocalState(
  store: BoardLocalStore,
  boardId: string | null,
): BoardLocalStateApi {
  return {
    strip: boardId === null ? EMPTY_BOARD_STRIP : store.stripOf(boardId),
    commitStrip: (next) => {
      if (boardId !== null) store.commitStrip(boardId, next);
    },
    forColumn: (columnId) =>
      boardId === null ? DEFAULT_COLUMN_STATE : store.forColumn(boardId, columnId),
    setScroll: (columnId, scroll) => {
      if (boardId !== null) store.setScroll(boardId, columnId, scroll);
    },
    setNav: (columnId, nav) => {
      if (boardId !== null) store.setNav(boardId, columnId, nav);
    },
    prune: (liveIds) => {
      if (boardId !== null) store.reconcile(boardId, liveIds);
    },
  };
}
