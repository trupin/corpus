import {
  archivedMessage,
  useCreateDoc,
  useDoc,
  useSetDocArchived,
  useUpdateDocById,
  type RowNotice,
} from "@corpus/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Column } from "../board/Column";
import { measureColumns, previewOrder } from "../board/columnDrag";
import { nextOrder, reinsert } from "../board/columnOrder";
import { useRegisterBoardCommands, type BoardCommands } from "../keyboard/boardCommands";
import { useContextMenu } from "../menu/ContextMenuHost";
import { RowMenuItems, subjectFromElement } from "../menu/RowMenuItems";
import { resolveListItem } from "../plugins/slots";
import { focusReplyComposer, replyRoot } from "../keyboard/focusReply";
import { useActiveColumn } from "../keyboard/useActiveColumn";
import { useRowCursor } from "../keyboard/useRowCursor";
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
import { openDocId, useBoardLocalState } from "../board/useBoardLocalState";
import { useColumns } from "../board/useColumns";
import { useColumnOrder } from "../board/useColumnOrder";
import { useCreateInColumn } from "../board/useCreateInColumn";
import type { BoardColumn } from "../board/viewDoc";
import { FocusMode } from "../reader/FocusMode";
import { pushEntry } from "../reader/useNavStack";
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
  // `e` archives through the route that owns the transition, not through a
  // status patch: only `POST …/archive` moves a skill's folder out of
  // `.claude/skills/` (UI-020). `updateDoc` stays for the column reorder, which
  // really is a frontmatter write.
  const setArchived = useSetDocArchived();
  const toast = useToast();
  const contextMenu = useContextMenu();

  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  const [picker, setPicker] = useState<MenuPosition | null>(null);
  const [selectTitleFor, setSelectTitleFor] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [flashing, setFlashing] = useState<string | null>(null);
  /**
   * Focus mode is board-level and **not** persisted: the column readers behind
   * it are the sticky state (SPEC.md §11's "open readers"), and restoring a
   * full-viewport overlay on load would hide the board a reload was meant to
   * show. Its own navigation stack lives inside the overlay.
   */
  const [focusDoc, setFocusDoc] = useState<{ columnTitle: string; docId: string } | null>(null);

  const board = useRef<HTMLElement>(null);
  /** Set by the board's own `drop`; a drag that ends anywhere else persists nothing. */
  const dropped = useRef(false);
  /** The column set as it stood when the drag began — what the move is computed against. */
  const dragSource = useRef<readonly BoardColumn[]>([]);
  const moving = useRef(false);

  const { prune, setNav, setScroll, forColumn } = local;

  /** Following a row, a ref or a backlink: a push onto that column's stack. */
  const openInColumn = useCallback(
    (columnId: string, docId: string) => {
      setNav(columnId, pushEntry(forColumn(columnId).nav, docId, 0));
    },
    [forColumn, setNav],
  );

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
        // A caller that names a column is looking at the row; resolution is for
        // callers that only know a document. The named column is still checked
        // against the live set, because an SSE frame may have unpinned it
        // between the keystroke and this call.
        const named =
          target.columnId != null &&
          orderedRef.current.some((column) => column.id === target.columnId)
            ? target.columnId
            : null;
        const columnId = named ?? resolveColumn(orderedRef.current, target.subject ?? null);
        if (columnId === null) return;
        openInColumn(columnId, target.docId);
        setSelectTitleFor(target.selectTitle === true ? target.docId : null);
        setScrollTo(columnId);
        setFlashing(columnId);
      },
      revealColumn: (columnId) => {
        setScrollTo(columnId);
        setFlashing(columnId);
      },
    }),
    [openInColumn],
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

  const active = useActiveColumn(ordered);
  const activeColumnId = active.id;
  const activeColumn = ordered[active.index] ?? null;
  const cursor = useRowCursor({ board, activeColumnId });

  /**
   * The document the active column has open, if any — `e` and `f` act on it in
   * preference to the row under the cursor (SPEC.md §11: "archive the open (or
   * highlighted) document"). The fetch costs nothing: the reader below is
   * already asking for exactly this key.
   */
  const openInActive = activeColumnId === null ? null : openDocId(forColumn(activeColumnId));
  const openDoc = useDoc(openInActive ?? undefined);

  /**
   * The one way out of focus mode — every close goes through here (UI-031).
   *
   * Closing is programmatic and the pointer is wherever the user left it, which
   * is usually not over the column focus was entered from. Unmounting the
   * full-viewport overlay makes the column under that resting cursor fire
   * `mouseover`, and `activate` would hand it the board on the strength of a
   * gesture nobody made — leaving `esc` dead over a column with no reader open
   * (the UI-022 finding: seven dead presses, surviving a reload, cured by
   * wiggling the mouse). So the close arms the keyboard's latch on the column
   * that is already active; the next real `mousemove` releases it and
   * hover-follows-active resumes untouched.
   *
   * It must stay the only close: `esc`, `⌫`, the ✕ button and the depth-0
   * auto-close all arrive as `FocusMode`'s `onClose`, and `f` toggles through
   * here too. A close that skipped it would reproduce the bug "only sometimes".
   */
  const closeFocus = useCallback(() => {
    active.hold();
    setFocusDoc(null);
  }, [active]);

  /**
   * `⇧←`/`⇧→` — the keyboard drag (SPEC.md §11). Same `persistMove` the pointer
   * drag ends in, so `order` is written through UI-003's one path; a silent
   * no-op at either end, with no wrap-around and no write.
   */
  const moveActiveColumn = useCallback(
    (delta: -1 | 1) => {
      const from = ordered.findIndex((column) => column.id === activeColumnId);
      if (from < 0) return;
      const to = from + delta;
      if (to < 0 || to >= ordered.length) return;
      setPreview(
        reinsert(
          ordered.map((column) => column.id),
          from,
          to,
        ),
      );
      const moved = ordered[from]?.id ?? null;
      // The moved column stays active and comes back into view: the gesture is
      // about *this* list, and losing it to whatever slid under the cursor is
      // how a second `⇧→` moves the wrong one.
      if (moved !== null) active.pin(moved);
      setScrollTo(moved);
      void persistMove(ordered, from, to);
    },
    [active, activeColumnId, ordered, persistMove],
  );

  /**
   * `e` — the open document when one is open, otherwise the row under the
   * cursor. The row's own status and title are read from what it rendered:
   * asking the server for a document the user is looking at, to learn whether
   * to tell them it is already archived, would be a request per keystroke.
   */
  const archiveTarget = useCallback(() => {
    // An open reader is the target even before its document has arrived: the
    // alternative — falling through to the row under the cursor while the
    // document loads — would archive something the user is not looking at.
    if (openInActive !== null && openDoc.data === undefined) {
      toast({ tone: "info", message: "Still opening that document — try again in a moment." });
      return;
    }

    const row = cursor.element();
    const target =
      openDoc.data !== undefined && openInActive !== null
        ? {
            id: openInActive,
            title: openDoc.data.frontmatter.title,
            status: openDoc.data.frontmatter.status,
          }
        : row === null
          ? null
          : {
              id: row.dataset["rowDoc"] ?? "",
              title: row.querySelector(".row-title")?.textContent ?? "",
              status: row.dataset["rowStatus"] ?? "",
            };

    if (target === null || target.id === "") {
      toast({ tone: "info", message: "Nothing to archive — open a document or highlight a row." });
      return;
    }
    if (target.status === "archived") {
      toast({ tone: "info", message: `“${target.title}” is already archived.` });
      return;
    }
    void (async () => {
      try {
        await setArchived.mutateAsync({ id: target.id, archived: true });
        toast({ tone: "info", message: archivedMessage(target.title) });
      } catch (cause) {
        toast({ tone: "error", message: `Archive failed — ${(cause as Error).message}` });
      }
    })();
  }, [cursor, openDoc.data, openInActive, setArchived, toast]);

  /**
   * The menu key / `⇧F10` (SPEC.md §11): the same menu the pointer opens, on the
   * row the keyboard is highlighting, with its first item focused.
   *
   * The subject is read off the painted row rather than from a result set the
   * board does not hold — the same source `archiveTarget` and `useRowCursor`
   * already read.
   */
  const openRowMenu = useCallback(() => {
    const element = cursor.element();
    if (element === null) return;
    const subject = subjectFromElement(element);
    // A plugin `ListItem` owns its surface; v1 leaves it alone (sign-off item 4).
    if (subject === null || resolveListItem(subject.type) !== null) return;
    const rect = element.getBoundingClientRect();
    contextMenu.open({
      label: `Actions for ${subject.title}`,
      clientX: rect.left + 16,
      clientY: rect.bottom - 8,
      autoFocus: true,
      items: (close) => (
        <RowMenuItems
          subject={subject}
          close={close}
          onOpen={() => {
            navigation.open({
              docId: subject.id,
              ...(activeColumnId === null ? {} : { columnId: activeColumnId }),
            });
          }}
          onOpenFocus={() => {
            navigation.open({
              docId: subject.id,
              ...(activeColumnId === null ? {} : { columnId: activeColumnId }),
            });
            setFocusDoc({ columnTitle: activeColumn?.title ?? "", docId: subject.id });
          }}
          onNotify={notify}
        />
      ),
    });
  }, [activeColumn, activeColumnId, contextMenu, cursor, navigation, notify]);

  /** The board's half of the keyboard seam: §11's bindings, phrased as acts. */
  const commands = useMemo<BoardCommands>(
    () => ({
      moveRowCursor: cursor.move,
      openRowAtCursor: (fullScreen) => {
        if (cursor.docId === null || activeColumnId === null) return;
        navigation.open({ docId: cursor.docId, columnId: activeColumnId });
        if (fullScreen) {
          setFocusDoc({ columnTitle: activeColumn?.title ?? "", docId: cursor.docId });
        }
      },
      switchColumn: (delta) => {
        const next = active.switchBy(delta);
        if (next !== null) setScrollTo(next);
      },
      moveActiveColumn,
      toggleFocusMode: () => {
        if (focusDoc !== null) {
          closeFocus();
          return;
        }
        if (openInActive === null) return;
        setFocusDoc({ columnTitle: activeColumn?.title ?? "", docId: openInActive });
      },
      archiveTarget,
      openContextMenu: openRowMenu,
      focusReply: () => {
        if (focusReplyComposer(replyRoot(board.current, activeColumnId)) === "none") {
          toast({ tone: "info", message: "No thread to reply to on this document." });
        }
      },
    }),
    [
      active,
      activeColumn,
      activeColumnId,
      archiveTarget,
      closeFocus,
      cursor,
      focusDoc,
      moveActiveColumn,
      navigation,
      openInActive,
      openRowMenu,
      toast,
    ],
  );

  useRegisterBoardCommands(commands);

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
        openInColumn(column.id, docId);
        setSelectTitleFor(docId);
        toast({
          tone: "info",
          message: `Created in ${column.folder ?? "inbox"}/ — committed; the title is selected.`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `Create failed — ${(cause as Error).message}` });
      }
    },
    [createInColumn, openInColumn, toast],
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
          selectTitle={openDocId(forColumn(column.id)) === selectTitleFor}
          cursorDocId={column.id === activeColumnId ? cursor.docId : null}
          onActivate={() => {
            active.activate(column.id);
          }}
          onScroll={(scrollTop) => {
            setScroll(column.id, scrollTop);
          }}
          onOpen={(docId) => {
            openInColumn(column.id, docId);
          }}
          onNav={(nav) => {
            setNav(column.id, nav);
            if (nav.length === 0) setSelectTitleFor(null);
          }}
          onFocusMode={(docId) => {
            setFocusDoc({ columnTitle: column.title, docId });
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

      {focusDoc === null ? null : (
        <FocusMode
          docId={focusDoc.docId}
          listTitle={focusDoc.columnTitle}
          onClose={closeFocus}
          onNotify={notify}
        />
      )}

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
