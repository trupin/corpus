import { useCreateDoc, useUpdateDocById, type RowNotice } from "@corpus/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Column } from "../board/Column";
import { measureColumns, previewOrder } from "../board/columnDrag";
import { nextOrder, reinsert } from "../board/columnOrder";
import {
  clampMenuPosition,
  columnRequest,
  type MenuPosition,
  type NewListChoice,
} from "../board/newList";
import { NewListGhost } from "../board/NewListGhost";
import { NewListPicker } from "../board/NewListPicker";
import {
  COLUMN_FLASH_MS,
  resolveColumn,
  useRegisterBoardNavigation,
  type BoardNavigation,
} from "../board/openInColumn";
import { useBoardLocalState } from "../board/useBoardLocalState";
import { useColumns } from "../board/useColumns";
import { useColumnOrder } from "../board/useColumnOrder";
import { useCreateInColumn } from "../board/useCreateInColumn";
import type { BoardColumn } from "../board/viewDoc";
import { useToast } from "./Toasts";
import "./Board.css";
import "../board/Column.css";

/**
 * The board (SPEC.md §11): a horizontally scrolling strip of columns with snap
 * scrolling, and a trailing ghost column that never lets it be a blank screen.
 *
 * **Columns are documents.** Nothing here decides what the board holds — the
 * corpus does, through pinned `type: view` documents. Reordering, renaming,
 * re-querying, pinning and unpinning are all writes to those documents, which
 * is what makes the layout auto-committed, stewardable by the agent, and the
 * same in a second browser. The only state this component keeps for itself is
 * the state that is genuinely about *this* browser: where each list is scrolled
 * and which document each column has open.
 *
 * The scroller stays in `shell/` because `.board` is one of the shell's three
 * regions (top bar · board · console); everything a column *is* lives in
 * `../board/`.
 */
export function Board(): ReactElement {
  const { columns, isPending, error } = useColumns();
  const local = useBoardLocalState();
  const columnOrder = useColumnOrder();
  const createDoc = useCreateDoc();
  const createInColumn = useCreateInColumn();
  const updateDoc = useUpdateDocById();
  const toast = useToast();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  const [picker, setPicker] = useState<MenuPosition | null>(null);
  const [selectTitleFor, setSelectTitleFor] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [flashing, setFlashing] = useState<string | null>(null);

  const board = useRef<HTMLElement>(null);
  /** Set by the board's own `drop`; a drag that ends anywhere else persists nothing. */
  const dropped = useRef(false);
  /** The column set as it stood when the drag began — what the move is computed against. */
  const dragSource = useRef<readonly BoardColumn[]>([]);
  const moving = useRef(false);

  const { prune, setOpen, setScroll, forColumn } = local;

  /**
   * What is rendered: the fetched-and-sorted set, or — while a drag or a
   * just-issued move is outstanding — the same columns in the sequence the
   * gesture asked for. It is a rearrangement of the fetched set, never a
   * different set, so a column can never appear that no document backs.
   */
  const ordered = useMemo(() => {
    if (preview === null) return columns;
    const byId = new Map(columns.map((column) => [column.id, column]));
    const arranged = preview
      .map((id) => byId.get(id))
      .filter((column): column is BoardColumn => column !== undefined);
    return arranged.length === columns.length ? arranged : columns;
  }, [columns, preview]);

  const serverIds = columns.map((column) => column.id).join(",");

  // Local entries for columns that no longer exist — an archived view, one the
  // agent removed — go with them, along with whatever reader they had open.
  useEffect(() => {
    if (isPending || error !== null) return;
    prune(serverIds === "" ? [] : serverIds.split(","));
  }, [error, isPending, prune, serverIds]);

  /**
   * The preview is held until the corpus agrees with it — that is the whole
   * point of not reordering the DOM imperatively — and then dropped after a
   * grace period regardless, so a concurrent out-of-band rewrite reconciles to
   * the server's answer instead of leaving the user looking at a position no
   * document holds.
   */
  useEffect(() => {
    if (preview === null) return undefined;
    if (serverIds === preview.join(",")) {
      setPreview(null);
      return undefined;
    }
    if (dragId !== null) return undefined;
    const timer = setTimeout(() => {
      setPreview(null);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [dragId, preview, serverIds]);

  useEffect(() => {
    if (scrollTo === null) return;
    const element = board.current?.querySelector<HTMLElement>(`.col[data-col="${scrollTo}"]`);
    if (element === null || element === undefined) return;
    // jsdom implements no layout and therefore no `scrollIntoView`.
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
    setScrollTo(null);
  }, [ordered, scrollTo]);

  // The accent border the prototype lights for 1.5 s after a column is scrolled
  // to. Its transition is covered by the shipped `.col` reduced-motion guard in
  // `app/global.css`, which is why nothing is re-declared for it.
  useEffect(() => {
    if (flashing === null) return undefined;
    const timer = setTimeout(() => {
      setFlashing(null);
    }, COLUMN_FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flashing]);

  /**
   * The board's half of the `useOpenInColumn` seam (SPEC.md §11).
   *
   * Resolution reads the *rendered* column set through a ref so the published
   * handlers keep a stable identity: the search overlay holds them across every
   * keystroke, and a new function per render would re-register on each one.
   */
  const orderedRef = useRef<readonly BoardColumn[]>(ordered);
  orderedRef.current = ordered;

  const navigation = useMemo<BoardNavigation>(
    () => ({
      open: (target) => {
        const columnId = resolveColumn(orderedRef.current, target.subject ?? null);
        if (columnId === null) return;
        setOpen(columnId, target.docId);
        setSelectTitleFor(target.selectTitle === true ? target.docId : null);
        setScrollTo(columnId);
        setFlashing(columnId);
      },
      revealColumn: (columnId) => {
        setScrollTo(columnId);
        setFlashing(columnId);
      },
    }),
    [setOpen],
  );

  useRegisterBoardNavigation(navigation);

  const notify = useCallback(
    (notice: RowNotice) => {
      toast(notice);
    },
    [toast],
  );

  const persistMove = useCallback(
    async (source: readonly BoardColumn[], fromIndex: number, toIndex: number) => {
      if (moving.current) return;
      moving.current = true;
      const title = source[fromIndex]?.title ?? "";
      try {
        const written = await columnOrder.move(
          source.map((column) => ({ id: column.id, order: column.order })),
          fromIndex,
          toIndex,
        );
        if (written === 0) {
          setPreview(null);
          return;
        }
        toast({
          tone: "info",
          message: `List moved — “${title}” reordered; ${String(written)} view document${
            written === 1 ? "" : "s"
          } updated and committed.`,
        });
      } catch (cause) {
        setPreview(null);
        toast({ tone: "error", message: `Reorder failed — ${(cause as Error).message}` });
      } finally {
        moving.current = false;
      }
    },
    [columnOrder, toast],
  );

  const activeIndex = Math.max(
    0,
    ordered.findIndex((column) => column.id === activeId),
  );
  const activeColumnId = ordered[activeIndex]?.id ?? null;

  // `⇧←`/`⇧→` — the keyboard drag (SPEC.md §11). Same mutation as the pointer
  // drag, and a silent no-op at either end: no wrap-around, no write.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      // The target is the `document` itself when nothing is focused, and only
      // an `Element` answers `closest`.
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable === true) return;
      if (target?.closest("input, textarea, select") != null) return;

      const from = ordered.findIndex((column) => column.id === activeColumnId);
      if (from < 0) return;
      const to = event.key === "ArrowLeft" ? from - 1 : from + 1;
      if (to < 0 || to >= ordered.length) return;

      event.preventDefault();
      setPreview(
        reinsert(
          ordered.map((column) => column.id),
          from,
          to,
        ),
      );
      setScrollTo(ordered[from]?.id ?? null);
      void persistMove(ordered, from, to);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeColumnId, ordered, persistMove]);

  // `Esc` mid-drag restores the pre-drag order and persists nothing.
  useEffect(() => {
    if (dragId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      dropped.current = false;
      setPreview(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dragId]);

  const finishDrag = useCallback(() => {
    const draggedId = dragId;
    setDragId(null);
    const source = dragSource.current;
    if (!dropped.current || draggedId === null || preview === null) {
      setPreview(null);
      return;
    }
    dropped.current = false;
    const from = source.findIndex((column) => column.id === draggedId);
    const to = preview.indexOf(draggedId);
    if (from < 0 || to < 0 || from === to) {
      setPreview(null);
      return;
    }
    void persistMove(source, from, to);
  }, [dragId, persistMove, preview]);

  const addToColumn = useCallback(
    async (column: BoardColumn) => {
      try {
        const docId = await createInColumn.create({
          folder: column.folder,
          plugin: column.plugin,
        });
        setOpen(column.id, docId);
        setSelectTitleFor(docId);
        toast({
          tone: "info",
          message: `Created in ${column.folder ?? "inbox"}/ — committed; the title is selected.`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `Create failed — ${(cause as Error).message}` });
      }
    },
    [createInColumn, setOpen, toast],
  );

  const editColumn = useCallback(
    async (
      column: BoardColumn,
      changes: Parameters<typeof updateDoc.mutateAsync>[0]["changes"],
      message: string,
      verb: string,
    ) => {
      try {
        await updateDoc.mutateAsync({ id: column.id, changes });
        toast({ tone: "info", message });
      } catch (cause) {
        toast({ tone: "error", message: `${verb} failed — ${(cause as Error).message}` });
      }
    },
    [toast, updateDoc],
  );

  const chooseNewList = useCallback(
    async (choice: NewListChoice) => {
      setPicker(null);
      try {
        const response = await createDoc.mutateAsync(columnRequest(choice, nextOrder(columns)));
        setScrollTo(response.doc.frontmatter.id);
        toast({
          tone: "info",
          message: `Pinned — a view document was created for “${choice.title}” (pinned: true, order: last).`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `Pin failed — ${(cause as Error).message}` });
      }
    },
    [columns, createDoc, toast],
  );

  return (
    <main
      ref={board}
      className="board"
      aria-label="Document lists"
      onDragOver={(event) => {
        if (dragId === null || board.current === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const next = previewOrder(
          ordered.map((column) => column.id),
          dragId,
          measureColumns(board.current),
          event.clientX,
        );
        setPreview((current) =>
          current !== null && current.join(",") === next.join(",") ? current : next,
        );
      }}
      onDrop={(event) => {
        event.preventDefault();
        dropped.current = true;
      }}
    >
      {error === null ? null : (
        <div className="col col-card-error board-error" role="alert">
          <p className="col-card-title">The column set could not be loaded</p>
          <p className="col-card-body">{error.message}</p>
        </div>
      )}

      {ordered.map((column) => (
        <Column
          key={column.id}
          column={column}
          isActive={column.id === activeColumnId}
          isDragging={column.id === dragId}
          isFlashing={column.id === flashing}
          local={forColumn(column.id)}
          selectTitle={forColumn(column.id).open === selectTitleFor}
          onActivate={() => {
            setActiveId(column.id);
          }}
          onScroll={(scrollTop) => {
            setScroll(column.id, scrollTop);
          }}
          onOpen={(docId) => {
            setOpen(column.id, docId);
            if (docId === null) setSelectTitleFor(null);
          }}
          onAdd={() => {
            void addToColumn(column);
          }}
          onRename={(title) => {
            void editColumn(
              column,
              { title },
              `Renamed — the view document’s title is now “${title}”.`,
              "Rename",
            );
          }}
          onEditQuery={(query) => {
            void editColumn(
              column,
              { query: Object.keys(query).length === 0 ? null : query },
              `Query updated — “${column.title}” now filters on the corpus, not on this browser.`,
              "Edit query",
            );
          }}
          onUnpin={() => {
            void editColumn(
              column,
              { status: "archived" },
              `Unpinned — “${column.title}” was archived, not deleted; it is still in the corpus.`,
              "Unpin",
            );
          }}
          onDragStart={() => {
            dragSource.current = ordered;
            dropped.current = false;
            setDragId(column.id);
            setPreview(ordered.map((entry) => entry.id));
          }}
          onDragEnd={finishDrag}
          onNotify={notify}
        />
      ))}

      <NewListGhost
        onOpen={(clientX, clientY) => {
          setPicker(
            clampMenuPosition(clientX, clientY, {
              width: globalThis.innerWidth,
              height: globalThis.innerHeight,
            }),
          );
        }}
      />

      {picker === null ? null : (
        <NewListPicker
          position={picker}
          // The overlay owns its query and does not outlive itself: "save as
          // view" and `⇧↵` pin a search from inside the overlay, where the query
          // is live. Handing the board a copy of a search the user has already
          // closed would offer to pin a query nothing is showing.
          searchQuery=""
          onChoose={(choice) => {
            void chooseNewList(choice);
          }}
          onClose={() => {
            setPicker(null);
          }}
        />
      )}
    </main>
  );
}
