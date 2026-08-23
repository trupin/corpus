import {
  useCreateDoc,
  useDeleteDoc,
  useReorderBoards,
  useSetDocArchived,
  useUpdateDocById,
  type RowNotice,
} from "@corpus/kit";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import { useToast } from "../shell/Toasts";
import { BOARD_DOCUMENT_FOLDER, resolveBoard, type Board, type KanbanSpec } from "./boardDoc";
import { openFromExplorer as openFromExplorerAct, openLoose } from "./strip";
import { nextBoardOrder, planBoardReorder } from "./boardOrder";
import {
  bindBoardLocalState,
  useBoardLocalState,
  type BoardLocalStateApi,
} from "./useBoardLocalState";
import { useBoards } from "./useBoards";
import { useColumnOrder } from "./useColumnOrder";

/**
 * The boards, the one being shown, and every write that touches a board
 * document (SPEC.md §10, rider 2).
 *
 * **One place, because a board document is written from four surfaces.** The
 * bar's tabs and menu, the board's own column drag and `⇧←`/`⇧→`, the search
 * overlay's "save as view", and the explorer (UI-150) all edit `columns`,
 * `order` or `default-open`. Spreading those across the components that host the
 * gesture is how two of them end up disagreeing about what "add a column" means.
 *
 * **It also owns the browser-local half**, for a duller reason: the selected
 * board and each column's scroll position live in one `localStorage` blob, and
 * two components each holding their own `useState` copy of one blob is two
 * copies that diverge on the first write. `useBoardLocalState` is called exactly
 * once, here, and handed down.
 */

export interface BoardSurface {
  readonly boards: readonly Board[];
  /** The board being shown, or `null` when the workspace holds none. */
  readonly current: Board | null;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly local: BoardLocalStateApi;
  /** Shows a board that is already on the bar. */
  readonly showBoard: (boardId: string) => void;
  /**
   * "Open in <board>" (SPEC.md §10, rider 3): lands the document as a **loose
   * path at the left edge** of the named board and shows it. The write goes to
   * that board's browser-local strip — a board document never records a path.
   */
  readonly openOnBoard: (boardId: string, docId: string) => void;
  /**
   * The explorer's open onto a board that is **not** the one showing (UI-150).
   *
   * Written here rather than through `useOpenInColumn`, and the reason is a
   * race: that seam acts on the strip the board is holding *now*, so switching
   * the board and opening in one handler would commit the path into the board
   * being left. This writes the target board's stored strip directly — exactly
   * as {@link openOnBoard} does — and then shows it.
   *
   * When the target *is* the showing board the explorer uses the seam instead,
   * because only the board can scroll to the column and flash it. Both call the
   * same act (`openFromExplorer` in `strip.ts`), so the preview and replacement
   * rules have one implementation.
   */
  readonly openFromExplorer: (
    boardId: string,
    docId: string,
    options?: { readonly keep?: boolean },
  ) => void;
  /**
   * **The explorer's act** (SPEC.md §10, rider 1: "a `type: board` document in
   * the tree *is* the board: clicking it shows that board, restoring it first if
   * it was archived"). Exported for UI-150.
   */
  readonly openBoard: (boardId: string) => Promise<void>;
  readonly createBoard: () => Promise<void>;
  /**
   * Creates a **kanban** board (SPEC.md §10, rider 6): one document carrying the
   * `kanban` block and the scope query, which is the whole of a kanban — its
   * columns are derived and no view document is written.
   */
  readonly createKanban: (request: NewKanban) => Promise<void>;
  /**
   * Rewrites one board's `kanban` block — the stages, their order, the
   * transitions. Every act on a stage column lands here, because a stage is not
   * a column somebody added to a board but one of the values it is drawn over.
   */
  readonly setKanban: (board: Board, kanban: KanbanSpec, message: string) => Promise<void>;
  readonly renameBoard: (board: Board, title: string) => Promise<void>;
  readonly archiveBoard: (board: Board) => Promise<void>;
  readonly deleteBoard: (board: Board) => Promise<void>;
  readonly setDefaultBoard: (board: Board) => Promise<void>;
  /**
   * Drag or Move left/right: writes `order` on every board that moved, in one
   * commit (SPEC.md §10, rider 2).
   */
  readonly moveBoard: (fromIndex: number, toIndex: number) => Promise<void>;
  /** Appends a view document to the showing board's `columns`. */
  readonly addColumn: (viewId: string) => Promise<void>;
  /** Takes one column off the showing board by index; the view is left alone. */
  readonly removeColumn: (index: number, title: string) => Promise<void>;
  /** Moves one column of the showing board; resolves `true` when it wrote. */
  readonly moveColumn: (fromIndex: number, toIndex: number) => Promise<boolean>;
}

const BoardsContext = createContext<BoardSurface | null>(null);

/** The title a board is born with — the same "type over it" shape a document has. */
export const UNTITLED_BOARD_TITLE = "New board";

/** What the kanban dialog collects, already parsed (`board/kanban.ts`). */
export interface NewKanban {
  readonly title: string;
  readonly kanban: KanbanSpec;
  /** The scope query — `{}` for a kanban over the whole corpus. */
  readonly query: Readonly<Record<string, string>>;
}

/**
 * What the bar says when the last board would go (SPEC.md §10, rider 2: "one
 * board is always showing: archiving the last board is refused"). Exported so
 * the spec asserting it and the code raising it are the same sentence.
 */
export const LAST_BOARD_REFUSAL =
  "One board is always showing — create another board before this one goes.";

export function BoardsProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const { boards, isPending, error } = useBoards();
  const toast = useToast();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDocById();
  const setArchived = useSetDocArchived();
  const deleteDoc = useDeleteDoc();
  const reorderBoards = useReorderBoards();
  const columnWrites = useColumnOrder();

  /*
   * Resolved on every render rather than stored: the remembered id is checked
   * against the **live** list, so a board that was archived, deleted or renamed
   * out of existence falls back exactly as a fresh browser does.
   */
  const store = useBoardLocalState();
  const { chooseBoard, pruneBoardSet } = store;
  const current = useMemo(() => resolveBoard(boards, store.chosenBoard), [boards, store]);
  const local = useMemo(() => bindBoardLocalState(store, current?.id ?? null), [current, store]);

  const liveBoardIds = boards.map((board) => board.id).join(",");
  useEffect(() => {
    if (isPending || error !== null) return;
    pruneBoardSet(liveBoardIds === "" ? [] : liveBoardIds.split(","));
  }, [error, isPending, liveBoardIds, pruneBoardSet]);

  const fail = useCallback(
    (verb: string, cause: unknown) => {
      const notice: RowNotice = {
        tone: "error",
        message: `${verb} failed — ${(cause as Error).message}`,
      };
      toast(notice);
    },
    [toast],
  );

  const showBoard = useCallback(
    (boardId: string) => {
      chooseBoard(boardId);
    },
    [chooseBoard],
  );

  const openOnBoard = useCallback(
    (boardId: string, docId: string) => {
      /*
       * The act is the same loose-left landing every origin-less open gets —
       * including the re-centre when the target board already shows the
       * document in a path. The flash cannot ride a board switch (the target
       * board mounts fresh), so the landing announces itself by being the
       * left-most column.
       */
      const result = openLoose(store.stripOf(boardId), docId);
      store.commitStrip(boardId, result.board);
      chooseBoard(boardId);
    },
    [chooseBoard, store],
  );

  const openFromExplorerOnBoard = useCallback(
    (boardId: string, docId: string, options: { readonly keep?: boolean } = {}) => {
      /*
       * The preview act, applied to a board this browser is not looking at.
       * Same rules — replace the preview, keep on `keep`, re-centre on a loop —
       * because it is the same pure function; only the flash is missing, which
       * cannot ride a board switch anyway (the target board mounts fresh).
       */
      const result = openFromExplorerAct(store.stripOf(boardId), docId, {
        ...(options.keep === undefined ? {} : { keep: options.keep }),
      });
      store.commitStrip(boardId, result.board);
      chooseBoard(boardId);
    },
    [chooseBoard, store],
  );

  const openBoard = useCallback(
    async (boardId: string) => {
      /*
       * A board already on the bar is simply shown. One that is not may be
       * archived — the tree keeps archived documents (rider 1) — so the restore
       * is attempted, and its failure is the honest answer for an id that names
       * nothing.
       */
      if (!boards.some((board) => board.id === boardId)) {
        try {
          await setArchived.mutateAsync({ id: boardId, archived: false });
          toast({ tone: "info", message: "Restored — the board is back on the bar." });
        } catch (cause) {
          fail("Open board", cause);
          return;
        }
      }
      chooseBoard(boardId);
    },
    [boards, chooseBoard, fail, setArchived, toast],
  );

  const createBoard = useCallback(async () => {
    try {
      const response = await createDoc.mutateAsync({
        type: "board",
        title: UNTITLED_BOARD_TITLE,
        folder: BOARD_DOCUMENT_FOLDER,
        columns: [],
        order: nextBoardOrder(boards),
      });
      const id = response.doc.frontmatter.id;
      chooseBoard(id);
      toast({
        tone: "info",
        message: `New board — ${BOARD_DOCUMENT_FOLDER}/ holds a document for it; add columns here or ask the agent to.`,
      });
    } catch (cause) {
      fail("New board", cause);
    }
  }, [boards, chooseBoard, createDoc, fail, toast]);

  const createKanban = useCallback(
    async (request: NewKanban) => {
      try {
        const response = await createDoc.mutateAsync({
          type: "board",
          title: request.title,
          folder: BOARD_DOCUMENT_FOLDER,
          kanban: request.kanban,
          ...(Object.keys(request.query).length === 0 ? {} : { query: request.query }),
          order: nextBoardOrder(boards),
        });
        chooseBoard(response.doc.frontmatter.id);
        toast({
          tone: "info",
          message:
            `New kanban — ${BOARD_DOCUMENT_FOLDER}/ holds a document over ` +
            `${request.kanban.field} with ${String(request.kanban.stages.length)} stages. ` +
            "The agent can write the same file.",
        });
      } catch (cause) {
        fail("New kanban", cause);
      }
    },
    [boards, chooseBoard, createDoc, fail, toast],
  );

  const setKanban = useCallback(
    async (board: Board, kanban: KanbanSpec, message: string) => {
      try {
        await updateDoc.mutateAsync({ id: board.id, changes: { kanban } });
        toast({ tone: "info", message });
      } catch (cause) {
        fail("Edit the board", cause);
      }
    },
    [fail, toast, updateDoc],
  );

  const renameBoard = useCallback(
    async (board: Board, title: string) => {
      const next = title.trim();
      if (next === "" || next === board.title) return;
      try {
        await updateDoc.mutateAsync({ id: board.id, changes: { title: next } });
        toast({ tone: "info", message: `Renamed — the board document’s title is now “${next}”.` });
      } catch (cause) {
        fail("Rename", cause);
      }
    },
    [fail, toast, updateDoc],
  );

  const archiveBoard = useCallback(
    async (board: Board) => {
      if (boards.length <= 1) {
        toast({ tone: "error", message: LAST_BOARD_REFUSAL });
        return;
      }
      try {
        await setArchived.mutateAsync({ id: board.id, archived: true });
        toast({
          tone: "info",
          message: `Archived — “${board.title}” left the bar; it is still in the corpus, under ${BOARD_DOCUMENT_FOLDER}/.`,
        });
      } catch (cause) {
        fail("Archive", cause);
      }
    },
    [boards.length, fail, setArchived, toast],
  );

  const deleteBoard = useCallback(
    async (board: Board) => {
      if (boards.length <= 1) {
        toast({ tone: "error", message: LAST_BOARD_REFUSAL });
        return;
      }
      try {
        await deleteDoc.mutateAsync(board.id);
        toast({
          tone: "info",
          message: `Deleted — “${board.title}” is gone from disk; git still holds it. The view documents it listed are untouched.`,
        });
      } catch (cause) {
        fail("Delete", cause);
      }
    },
    [boards.length, deleteDoc, fail, toast],
  );

  const setDefaultBoard = useCallback(
    async (board: Board) => {
      try {
        /*
         * The server clears every other board in the same commit and names them
         * in its result (SERVER-138), so nothing is cleared here: a client that
         * also wrote `defaultOpen: false` on the others would be racing the
         * write it just asked for.
         */
        await updateDoc.mutateAsync({ id: board.id, changes: { defaultOpen: true } });
        toast({
          tone: "info",
          message: `“${board.title}” now receives every open that names no board.`,
        });
      } catch (cause) {
        fail("Set default", cause);
      }
    },
    [fail, toast, updateDoc],
  );

  const moveBoard = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const order = planBoardReorder(boards, fromIndex, toIndex);
      if (order.length === 0) return;
      try {
        /*
         * One request, and therefore one commit (SPEC.md §10, rider 2:
         * "reordering boards writes `order` on every board, in one commit").
         * The positions are the server's to derive — it numbers the list from
         * one and writes only the boards that moved — so nothing here computes
         * an `order` value, and the count in the message is what the act
         * reports having written rather than what this browser guessed.
         */
        const result = await reorderBoards.mutateAsync(order);
        const written = result.boards.filter((board) => board.changed).length;
        toast({
          tone: "info",
          message:
            // Never claims a commit the act did not make: every board was
            // already at its number, so nothing was written and `commit` is
            // null. Rare from a drag, and free to say honestly.
            result.commit === null
              ? "Board order unchanged — every board was already where you put it."
              : `Board order written — ${String(written)} board document${
                  written === 1 ? "" : "s"
                } updated in one commit.`,
        });
      } catch (cause) {
        fail("Reorder", cause);
      }
    },
    [boards, fail, reorderBoards, toast],
  );

  const addColumn = useCallback(
    async (viewId: string) => {
      if (current === null) return;
      await columnWrites.append(current.id, current.columnIds, viewId);
    },
    [columnWrites, current],
  );

  const removeColumn = useCallback(
    async (index: number, title: string) => {
      if (current === null) return;
      try {
        await columnWrites.remove(current.id, current.columnIds, index);
        toast({
          tone: "info",
          message: `Removed from “${current.title}” — the board document no longer lists “${title}”. The view document is untouched.`,
        });
      } catch (cause) {
        fail("Remove from this board", cause);
      }
    },
    [columnWrites, current, fail, toast],
  );

  const moveColumn = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (current === null) return false;
      return columnWrites.move(current.id, current.columnIds, fromIndex, toIndex);
    },
    [columnWrites, current],
  );

  const surface = useMemo<BoardSurface>(
    () => ({
      boards,
      current,
      isPending,
      error,
      local,
      showBoard,
      openOnBoard,
      openFromExplorer: openFromExplorerOnBoard,
      openBoard,
      createBoard,
      createKanban,
      setKanban,
      renameBoard,
      archiveBoard,
      deleteBoard,
      setDefaultBoard,
      moveBoard,
      addColumn,
      removeColumn,
      moveColumn,
    }),
    [
      addColumn,
      archiveBoard,
      boards,
      createBoard,
      createKanban,
      current,
      deleteBoard,
      error,
      isPending,
      local,
      moveBoard,
      moveColumn,
      openBoard,
      openFromExplorerOnBoard,
      openOnBoard,
      removeColumn,
      renameBoard,
      setDefaultBoard,
      setKanban,
      showBoard,
    ],
  );

  return <BoardsContext.Provider value={surface}>{children}</BoardsContext.Provider>;
}

/**
 * The board surface. Throws outside the provider rather than answering with an
 * empty board: a surface that silently reported "no boards" would look exactly
 * like a workspace that needs `corpus upgrade`.
 */
export function useBoardSurface(): BoardSurface {
  const surface = useContext(BoardsContext);
  if (surface === null) throw new Error("useBoardSurface must be used inside <BoardsProvider>");
  return surface;
}

/**
 * The surface, or `null` outside the provider — for components that merely
 * *decorate* with board knowledge (a row menu's "open in… <boards>") and are
 * legitimately rendered without one in component tests. Anything that *needs*
 * the surface keeps using {@link useBoardSurface}, whose throw is the guard
 * against a silent empty board.
 */
export function useMaybeBoardSurface(): BoardSurface | null {
  return useContext(BoardsContext);
}
