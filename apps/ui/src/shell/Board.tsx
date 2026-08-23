import {
  archivedMessage,
  useCreateDoc,
  useDoc,
  useSetDocArchived,
  useUpdateDocById,
  type OpenPayload,
  type RevealTarget,
  type RowNotice,
} from "@corpus/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useBoardSurface } from "../board/BoardsProvider";
import { Column, type ColumnKanban } from "../board/Column";
import { ColumnStrip } from "../board/ColumnStrip";
import { measureColumns, previewOrder } from "../board/columnDrag";
import { moveStage } from "../board/kanban";
import { useKanbanDrag } from "../board/kanbanDrag";
import { KanbanDialog, type KanbanDialogMode } from "../board/KanbanDialog";
import { reinsert } from "../board/columnOrder";
import { useRegisterBoardCommands, type BoardCommands } from "../keyboard/boardCommands";
import { useContextMenu } from "../menu/ContextMenuHost";
import { RowMenuItems, subjectFromElement } from "../menu/RowMenuItems";
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
  openRequest,
  useRegisterBoardNavigation,
  type BoardNavigation,
} from "../board/openInColumn";
import { PathBand, type PathActs } from "../board/PathBand";
import {
  closeAllPaths as closeAllPathsAct,
  closeCol,
  closeWholePath,
  detachPath,
  docAtKey,
  EXPLORER_ORIGIN,
  newPathRight,
  openDocsOn,
  openFromExplorer,
  openFromPath,
  openFromView,
  openLoose,
  originDocOf,
  parsePathKey,
  pathColumnKey,
  pathsOf,
  reconcileStrip,
  restartPathHere,
  setPathColStack,
  setPathColWidth,
  type PathItem,
  type StripResult,
} from "../board/strip";
import { openDocId } from "../board/useBoardLocalState";
import { useColumns } from "../board/useColumns";
import { useCreateInColumn } from "../board/useCreateInColumn";
import type { BoardColumn } from "../board/viewDoc";
import { FocusMode } from "../reader/FocusMode";
import { pushEntry } from "../reader/useNavStack";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { useToast } from "./Toasts";
import "./Board.css";
import "../board/Column.css";
import "../board/Kanban.css";
import "../board/Path.css";

/**
 * The showing board (SPEC.md §10): a horizontally scrolling strip of query
 * columns **and paths**, with snap scrolling, and a trailing ghost column that
 * never lets it be a blank screen.
 *
 * **Boards and columns are documents; paths are not.** What query columns the
 * board holds is corpus state — a `type: board` document listing view ids
 * (rider 2) — and every reorder, add and remove writes documents through the
 * board surface. The **paths** between those columns are rider 3's other half:
 * browser-local chains of reader columns hanging off origin rows, held in the
 * strip (`strip.ts`) under this board's `localStorage` slice, recorded in no
 * document ever.
 *
 * The strip rendered below is the stored one **reconciled against the fetched
 * column set at render time** — query items in board order, paths keeping their
 * place relative to the column before them — and the reconciled value is
 * committed back in an effect, so what is on screen and what is stored converge
 * without a frame that shows neither.
 */

/** What the loop rule says when it re-centres instead of opening (rider 3). */
export const ALREADY_IN_PATH_MESSAGE =
  "Already in this path — re-centred on its column. Nothing was closed.";

/**
 * What "keep" says (rider 3). One sentence for both the path column's own
 * Keep and the explorer's double click, because it is one act: the path stops
 * hanging off whatever opened it, and the next pick from there opens a new one.
 */
export const PATH_KEPT_MESSAGE = "Path kept — the next pick from its origin row opens a new one.";

export function Board(): ReactElement {
  const surface = useBoardSurface();
  const board = surface.current;
  const { columns, isPending, error } = useColumns(board);
  const local = surface.local;
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
  /** Which of the kanban form's two edit modes is open, or `null`. */
  const [kanbanEdit, setKanbanEdit] = useState<Exclude<KanbanDialogMode, "create"> | null>(null);
  /**
   * Focus mode is board-level and **not** persisted: the column readers behind
   * it are the sticky state (SPEC.md §10's "open readers"), and restoring a
   * full-viewport overlay on load would hide the board a reload was meant to
   * show. Its own navigation stack lives inside the overlay.
   */
  const [focusDoc, setFocusDoc] = useState<{
    columnTitle: string;
    docId: string;
    reveal?: RevealTarget | undefined;
  } | null>(null);

  const boardEl = useRef<HTMLElement>(null);
  /** Set by the board's own `drop`; a drag that ends anywhere else persists nothing. */
  const dropped = useRef(false);
  /** The column set as it stood when the drag began — what the move is computed against. */
  const dragSource = useRef<readonly BoardColumn[]>([]);
  const moving = useRef(false);

  const { setNav, setScroll, forColumn } = local;

  /** "Open here" in a query column: a push onto that column's own stack. */
  const openInColumn = useCallback(
    (columnId: string, docId: string, reveal?: RevealTarget) => {
      setNav(columnId, pushEntry(forColumn(columnId).nav, docId, 0, reveal));
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
  const orderedIds = ordered.map((column) => column.id).join(",");

  /**
   * The strip as this render draws it: the stored one, reconciled against the
   * rendered column order (drag preview included, so paths follow the column
   * they hang off while it moves).
   */
  const strip = useMemo(
    () => reconcileStrip(local.strip, orderedIds === "" ? [] : orderedIds.split(",")),
    [local.strip, orderedIds],
  );
  const stripRef = useRef(strip);
  stripRef.current = strip;

  // What was rendered is what is stored — including dropping the paths and
  // entries of columns that no longer exist (an archived view, one the agent
  // removed). Guarded exactly as the old prune was: never against a set that
  // is merely still loading.
  const { commitStrip } = local;
  useEffect(() => {
    if (isPending || error !== null) return;
    if (strip !== local.strip) commitStrip(strip);
  }, [commitStrip, error, isPending, local.strip, strip]);

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
    const element = boardEl.current?.querySelector<HTMLElement>(`.col[data-col="${scrollTo}"]`);
    if (element === null || element === undefined) return;
    // jsdom implements no layout and therefore no `scrollIntoView`.
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
    setScrollTo(null);
  }, [strip, scrollTo]);

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
   * The keyboard's column order is the strip's: query columns and path columns,
   * left to right, one key space (`strip.ts`).
   */
  const stripKeys = useMemo(
    () =>
      strip.strip.flatMap((item) =>
        item.kind === "query"
          ? [{ id: item.view }]
          : item.cols.map((_, index) => ({ id: pathColumnKey(item.id, index) })),
      ),
    [strip],
  );

  const active = useActiveColumn(stripKeys);
  const activeColumnId = active.id;
  /** The active **query** column, when the active key names one. */
  const activeColumn = ordered.find((column) => column.id === activeColumnId) ?? null;
  const cursor = useRowCursor({ board: boardEl, activeColumnId });

  /**
   * Applies a strip act: commit, then focus — pin (a keyboard-authority claim,
   * so the column sliding under a stationary cursor cannot steal it), scroll
   * in, and flash unless the caller is a quiet act like Back. The loop rule's
   * re-centre also says so, because a click that closed nothing and moved the
   * board needs its one-line account (rider 3).
   */
  const applyStrip = useCallback(
    (result: StripResult, options: { readonly flash?: boolean } = {}) => {
      if (result.board !== stripRef.current) commitStrip(result.board);
      if (result.focus !== null) {
        active.pin(result.focus);
        setScrollTo(result.focus);
        if (options.flash !== false) setFlashing(result.focus);
      }
      if (result.recentred) toast({ tone: "info", message: ALREADY_IN_PATH_MESSAGE });
    },
    [active, commitStrip, toast],
  );

  const closeEveryPath = useCallback(() => {
    const result = closeAllPathsAct(stripRef.current);
    if (result.closed === 0) return;
    commitStrip(result.board);
    if (result.focus !== null) {
      active.pin(result.focus);
      setScrollTo(result.focus);
    }
    toast({
      tone: "info",
      message: `Closed ${String(result.closed)} path${result.closed === 1 ? "" : "s"}.`,
    });
  }, [active, commitStrip, toast]);

  /**
   * The column strip's two acts (SPEC.md §10, rider 4).
   *
   * A tab click **pins** rather than activates: scrolling the board slides
   * columns under a stationary cursor, and `activate` would then hand the
   * active column to whatever landed beneath it — the same reason `⇧→` pins
   * (`useActiveColumn`). Nothing flashes: the tab's own outline is the
   * acknowledgement, and clicking the tab of a column already in view should
   * move nothing at all.
   */
  const goToColumn = useCallback(
    (key: string) => {
      active.pin(key);
      setScrollTo(key);
    },
    [active],
  );

  /** A path tab's `✕`: this column and everything after it (UI-149's act). */
  const closeFromStrip = useCallback(
    (pathId: number, index: number) => {
      applyStrip(closeCol(stripRef.current, pathId, index), { flash: false });
    },
    [applyStrip],
  );

  /**
   * `esc` and `⇧esc` on the board (SPEC.md §10's keyboard scheme): after the
   * overlays and focus mode — their layers outrank this one — `⇧esc` closes
   * every path, plain `esc` closes the **active path column**, and only then
   * does a query column's reader get its back. Registered only while a path
   * exists, so a path-free board keeps the pre-rider chain byte for byte.
   */
  const pathCount = pathsOf(strip).length;
  useEscapeLayer({
    active: pathCount > 0,
    priority: EscapeLayerPriority.PathStrip,
    onEscape: (event) => {
      if (event.shiftKey) {
        closeEveryPath();
        return;
      }
      const key = active.id;
      if (key === null) return;
      const parsed = parsePathKey(key);
      if (parsed !== null) {
        applyStrip(closeCol(stripRef.current, parsed.pathId, parsed.index), { flash: false });
        return;
      }
      // A query column's reader, behind this layer only while paths exist:
      // the same one-entry Back its own layer performs.
      const nav = forColumn(key).nav;
      if (nav.length > 0) setNav(key, nav.slice(0, -1));
    },
  });

  /**
   * The board's half of the `useOpenInColumn` seam (SPEC.md §10, rider 3):
   * every open lands in a path. A live named column hangs the path off its row;
   * everything else — no column, a column an SSE frame just removed, an
   * explicit `placement: "left"` — lands loose at the left edge.
   *
   * Resolution reads the *rendered* column set through a ref so the published
   * handlers keep a stable identity across keystrokes.
   */
  const orderedRef = useRef<readonly BoardColumn[]>(ordered);
  orderedRef.current = ordered;

  const navigation = useMemo<BoardNavigation>(
    () => ({
      open: (target) => {
        const named = target.origin?.view ?? target.columnId;
        /*
         * The explorer's origin is not a column and never resolves to one: its
         * path is a **preview**, replaced by the next explorer pick rather than
         * added beside it, and `openFromExplorer` is the act that says so
         * (rider 3). Branching here rather than inside the act keeps every other
         * caller on the two rules they already had.
         */
        if (named === EXPLORER_ORIGIN) {
          const keep = target.keep === true;
          const result = openFromExplorer(stripRef.current, target.docId, {
            keep,
            reveal: target.reveal,
          });
          applyStrip(result);
          setSelectTitleFor(target.selectTitle === true ? target.docId : null);
          if (keep) toast({ tone: "info", message: PATH_KEPT_MESSAGE });
          return;
        }
        const view =
          target.placement !== "left" &&
          named != null &&
          orderedRef.current.some((column) => column.id === named)
            ? named
            : null;
        const result =
          view !== null
            ? openFromView(stripRef.current, view, target.docId, target.reveal)
            : openLoose(stripRef.current, target.docId, target.reveal);
        applyStrip(result);
        setSelectTitleFor(target.selectTitle === true ? target.docId : null);
      },
      revealColumn: (columnId) => {
        setScrollTo(columnId);
        setFlashing(columnId);
      },
      openFullScreen: (docId, from) => {
        setFocusDoc({ columnTitle: from, docId });
      },
    }),
    [applyStrip, toast],
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
      const boardTitle = board?.title ?? "";
      try {
        const wrote = await surface.moveColumn(fromIndex, toIndex);
        if (!wrote) {
          setPreview(null);
          return;
        }
        toast({
          tone: "info",
          message: `List moved — “${title}” reordered on “${boardTitle}”; the board document was updated and committed.`,
        });
      } catch (cause) {
        setPreview(null);
        toast({ tone: "error", message: `Reorder failed — ${(cause as Error).message}` });
      } finally {
        moving.current = false;
      }
    },
    [board, surface, toast],
  );

  /**
   * The document the active column has open, if any — `e` and `f` act on it in
   * preference to the row under the cursor (SPEC.md §10). For a query column
   * that is its in-place reader's top; for a path column, the column's own
   * document. The fetch costs nothing: the reader below is already asking for
   * exactly this key.
   */
  const openInActive =
    activeColumnId === null
      ? null
      : parsePathKey(activeColumnId) === null
        ? openDocId(forColumn(activeColumnId))
        : docAtKey(strip, activeColumnId);
  const openDoc = useDoc(openInActive ?? undefined);

  /**
   * The one way out of focus mode — every close goes through here (UI-031).
   *
   * Closing is programmatic and the pointer is wherever the user left it, which
   * is usually not over the column focus was entered from. Unmounting the
   * full-viewport overlay makes the column under that resting cursor fire
   * `mouseover`, and `activate` would hand it the board on the strength of a
   * gesture nobody made — leaving `esc` dead over a column with no reader open
   * (the UI-022 finding). So the close arms the keyboard's latch on the column
   * that is already active; the next real `mousemove` releases it.
   *
   * It must stay the only close: `esc`, `⌫`, the ✕ button, the depth-0
   * auto-close and rider 3's link-follow (which closes focus before landing the
   * loose path) all arrive here, and `f` toggles through here too.
   */
  const closeFocus = useCallback(() => {
    active.hold();
    setFocusDoc(null);
  }, [active]);

  /**
   * `⇧←`/`⇧→` — the keyboard drag (SPEC.md §10). Same `persistMove` the pointer
   * drag ends in, so the board document is written through one path; a silent
   * no-op at either end, with no wrap-around and no write — and a no-op on a
   * path column, which is not a board-document column and cannot be "moved".
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
   * The menu key / `⇧F10` (SPEC.md §10): the same menu the pointer opens, on the
   * row the keyboard is highlighting, with its first item focused.
   *
   * The subject is read off the painted row rather than from a result set the
   * board does not hold — the same source `archiveTarget` and `useRowCursor`
   * already read.
   */
  const openRowMenu = useCallback(() => {
    const element = cursor.element();
    if (element === null) return;
    // The subject is read off the painted element, never from the row's type: a
    // document whose `type:` this build does not recognise is a core row with
    // the core action set (UI-036).
    const subject = subjectFromElement(element);
    if (subject === null) return;
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
          onOpenHere={() => {
            if (activeColumnId !== null && parsePathKey(activeColumnId) === null) {
              openInColumn(activeColumnId, subject.id);
            }
          }}
          onOpenFocus={() => {
            setFocusDoc({ columnTitle: activeColumn?.title ?? "", docId: subject.id });
          }}
          onNotify={notify}
        />
      ),
    });
  }, [activeColumn, activeColumnId, contextMenu, cursor, navigation, notify, openInColumn]);

  /** The board's half of the keyboard seam: §10's bindings, phrased as acts. */
  const commands = useMemo<BoardCommands>(
    () => ({
      moveRowCursor: cursor.move,
      openRowAtCursor: (mode) => {
        if (cursor.docId === null || activeColumnId === null) return;
        if (mode === "fullScreen") {
          // `⇧↵` opens **directly** in full screen (§10): the overlay and
          // nothing else — closing it returns to the board exactly as it was.
          setFocusDoc({ columnTitle: activeColumn?.title ?? "", docId: cursor.docId });
          return;
        }
        if (mode === "here") {
          if (parsePathKey(activeColumnId) === null) openInColumn(activeColumnId, cursor.docId);
          return;
        }
        navigation.open({ docId: cursor.docId, columnId: activeColumnId });
      },
      closeAllPaths: closeEveryPath,
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
        if (focusReplyComposer(replyRoot(boardEl.current, activeColumnId)) === "none") {
          toast({ tone: "info", message: "No thread to reply to on this document." });
        }
      },
    }),
    [
      active,
      activeColumn,
      activeColumnId,
      archiveTarget,
      closeEveryPath,
      closeFocus,
      cursor,
      focusDoc,
      moveActiveColumn,
      navigation,
      openInActive,
      openInColumn,
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

  /**
   * `＋` on a column (SPEC.md §10's creation bullet): the new document "opens
   * immediately in a path off its column, title selected, ready to type" — the
   * row it will grow under that column's own query is the path's origin.
   */
  const addToColumn = useCallback(
    async (column: BoardColumn) => {
      try {
        const docId = await createInColumn.create({ folder: column.folder });
        applyStrip(openFromView(stripRef.current, column.id, docId));
        setSelectTitleFor(docId);
        toast({
          tone: "info",
          message: `Created in ${column.folder ?? "inbox"}/ — committed; the title is selected.`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `Create failed — ${(cause as Error).message}` });
      }
    },
    [applyStrip, createInColumn, toast],
  );

  const editColumn = useCallback(
    async (
      column: BoardColumn,
      changes: Parameters<typeof updateDoc.mutateAsync>[0]["changes"],
      message: string,
      verb: string,
    ) => {
      try {
        await updateDoc.mutateAsync({ id: column.viewId, changes });
        toast({ tone: "info", message });
      } catch (cause) {
        toast({ tone: "error", message: `${verb} failed — ${(cause as Error).message}` });
      }
    },
    [toast, updateDoc],
  );

  /**
   * The ghost column's two writes (SPEC.md §10, rider 2): the view document, and
   * then its id on this board's `columns`.
   *
   * They are two commits rather than one — the wire has no multi-document write
   * — and the order matters: the board may only list an id that exists, so a
   * failure between them leaves a view document nothing lists rather than a
   * board naming a document that is not there.
   */
  const chooseNewList = useCallback(
    async (choice: NewListChoice) => {
      setPicker(null);
      if (board === null) {
        toast({ tone: "error", message: "No board is showing — a column has nowhere to go." });
        return;
      }
      try {
        const response = await createDoc.mutateAsync(columnRequest(choice));
        const docId = response.doc.frontmatter.id;
        await surface.addColumn(docId);
        setScrollTo(docId);
        toast({
          tone: "info",
          message: `Added to “${board.title}” — a view document was created for “${choice.title}” and listed on the board.`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `New list failed — ${(cause as Error).message}` });
      }
    },
    [board, createDoc, surface, toast],
  );

  /**
   * The kanban drag (SPEC.md §10, rider 6), live only on a kanban board — the
   * hook answers `null` for every column that is not a stage, so an ordinary
   * board pays one `useState` and nothing else.
   */
  const kanbanDrag = useKanbanDrag({ board, notify });

  /** One `⋯` act bundle per stage column, or `null` on a view column. */
  const kanbanFor = useCallback(
    (column: BoardColumn): ColumnKanban | null => {
      const stage = column.stage;
      if (stage === null || board === null || board.kanban === null) return null;
      const kanban = board.kanban;
      return {
        dropState: kanbanDrag.dropStateOf(column),
        rowsDraggable: true,
        acts: {
          stage: stage.stage,
          field: stage.field,
          canMoveLeft: stage.index > 0,
          canMoveRight: stage.index < stage.lastIndex,
          onEditStages: () => {
            setKanbanEdit("stages");
          },
          onEditTransitions: () => {
            setKanbanEdit("transitions");
          },
          onMove: (delta) => {
            const next = moveStage(kanban.stages, stage.index, stage.index + delta);
            if (next === kanban.stages) return;
            void surface.setKanban(
              board,
              { ...kanban, stages: [...next] },
              `Stage moved — “${stage.stage}” is now ${
                delta < 0 ? "earlier" : "later"
              } in “${board.title}”. The board document was updated and committed.`,
            );
          },
          onOpenBoard: () => {
            navigation.open({ docId: board.id, columnId: column.id });
          },
        },
        onRowDragStart: (row) => {
          kanbanDrag.onRowDragStart(column, row);
        },
        onRowDragEnd: kanbanDrag.onRowDragEnd,
        onDragOver: (event) => {
          kanbanDrag.onColumnDragOver(column, event);
        },
        onDrop: (event) => {
          kanbanDrag.onColumnDrop(column, event);
        },
      };
    },
    [board, kanbanDrag, navigation, surface],
  );

  /** Rider 3's marks, derived from the strip at render — never stored on rows. */
  const openSet = useMemo(() => openDocsOn(strip), [strip]);
  const byId = useMemo(() => new Map(ordered.map((column) => [column.id, column])), [ordered]);

  /** One act bundle per path — what `PathBand` hands its columns. */
  const actsFor = useCallback(
    (path: PathItem): PathActs => ({
      follow: (index, docId, fromScrollY, reveal) => {
        applyStrip(openFromPath(stripRef.current, path.id, index, docId, { reveal, fromScrollY }));
      },
      setStack: (index, stack) => {
        applyStrip(setPathColStack(stripRef.current, path.id, index, stack), { flash: false });
      },
      setWidth: (index, width) => {
        commitStrip(setPathColWidth(stripRef.current, path.id, index, width));
      },
      closeAfter: (index) => {
        applyStrip(closeCol(stripRef.current, path.id, index), { flash: false });
      },
      closeWholePath: () => {
        applyStrip(closeWholePath(stripRef.current, path.id), { flash: false });
      },
      restartHere: (index) => {
        applyStrip(restartPathHere(stripRef.current, path.id, index));
        toast({
          tone: "info",
          message: "Path restarted here — nothing hangs off a row any more.",
        });
      },
      newPathRight: (index) => {
        applyStrip(newPathRight(stripRef.current, path.id, index));
      },
      detach: () => {
        commitStrip(detachPath(stripRef.current, path.id));
        toast({ tone: "info", message: PATH_KEPT_MESSAGE });
      },
      focusMode: (docId) => {
        const originTitle =
          path.origin === null ? null : (byId.get(path.origin.view)?.title ?? null);
        setFocusDoc({ columnTitle: originTitle ?? "path", docId });
      },
    }),
    [applyStrip, byId, commitStrip, toast],
  );

  return (
    /*
     * `design/navigation.html`'s `.board-wrap`: the strip and the board are one
     * region, stacked, because the strip is a map of *this* scroller and has to
     * sit against it. The explorer becomes its sibling (UI-150), which is why
     * the wrapper is here rather than a second child of `.app`.
     */
    <div className="board-wrap">
      <ColumnStrip
        strip={strip}
        columns={ordered}
        boardRef={boardEl}
        activeKey={activeColumnId}
        onGo={goToColumn}
        onClose={closeFromStrip}
      />
      <main
        ref={boardEl}
        className="board"
        aria-label="Document lists"
        onDragOver={(event) => {
          if (dragId === null || boardEl.current === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const next = previewOrder(
            ordered.map((column) => column.id),
            dragId,
            measureColumns(boardEl.current),
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

        {/*
         * The empty states (`design/navigation.html`'s `.board-empty`), and there
         * are two of them because the answers differ.
         *
         * A board with no columns is a document with an empty `columns` list: the
         * fix is to add one, from the ghost column beside it or by asking the
         * agent. A workspace with **no board at all** has nothing to add a column
         * to, so the ghost is absent and the sentence names the migration — the
         * same one the bar's disabled tab names.
         */}
        {board === null && !surface.isPending && surface.error === null ? (
          <div className="board-empty">
            <b>No board is showing</b>
            This workspace holds no <code>type: board</code> document. Run{" "}
            <code>corpus upgrade</code>, which reports the migration that creates them as commands
            to run.
          </div>
        ) : null}

        {board !== null && !isPending && columns.length === 0 && pathCount === 0 ? (
          <div className="board-empty">
            <b>{board.title} is empty</b>
            Add columns to <code>boards/{board.id}.md</code> — with the ＋ beside this, or by asking
            the agent to.
          </div>
        ) : null}

        {strip.strip.map((item) => {
          if (item.kind === "path") {
            const originTitle =
              item.origin === null ? null : (byId.get(item.origin.view)?.title ?? null);
            return (
              <PathBand
                key={`path-${String(item.id)}`}
                path={item}
                originTitle={originTitle}
                activeKey={activeColumnId}
                flashingKey={flashing}
                selectTitleFor={selectTitleFor}
                acts={actsFor(item)}
                onActivate={(key) => {
                  active.activate(key);
                }}
                onNotify={notify}
              />
            );
          }
          const column = byId.get(item.view);
          if (column === undefined) return null;
          const columnLocal = { scroll: item.scroll, nav: item.nav };
          return (
            <Column
              key={column.id}
              column={column}
              kanban={kanbanFor(column)}
              isActive={column.id === activeColumnId}
              isDragging={column.id === dragId}
              isFlashing={column.id === flashing}
              local={columnLocal}
              selectTitle={openDocId(columnLocal) === selectTitleFor}
              cursorDocId={column.id === activeColumnId ? cursor.docId : null}
              originDocId={originDocOf(strip, column.id)}
              openDocIds={openSet}
              onActivate={() => {
                active.activate(column.id);
              }}
              onScroll={(scrollTop) => {
                setScroll(column.id, scrollTop);
              }}
              onOpenRow={(docId) => {
                applyStrip(openFromView(stripRef.current, column.id, docId));
              }}
              onOpen={(target: OpenPayload) => {
                const request = openRequest(target);
                openInColumn(column.id, request.docId, request.reveal);
              }}
              onNav={(nav) => {
                setNav(column.id, nav);
                if (nav.length === 0) setSelectTitleFor(null);
              }}
              onFocusMode={(target: OpenPayload) => {
                const request = openRequest(target);
                setFocusDoc({
                  columnTitle: column.title,
                  docId: request.docId,
                  reveal: request.reveal,
                });
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
              onRemove={() => {
                // The **board** document, by index: the view is left exactly where
                // it was, and a board listing the same view twice loses the copy the
                // user is looking at rather than both (SPEC.md §10, rider 2).
                //
                // The index is read from the *fetched* set rather than from the
                // rendered one, because the rendered one may be a drag preview and
                // the write goes to the array the server is holding.
                const at = columns.findIndex((entry) => entry.id === column.id);
                if (at >= 0) void surface.removeColumn(at, column.title);
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
          );
        })}

        {/* No board is no place to put a column, so the ghost is absent rather
          than offering a creation that has nowhere to land. A **kanban** is the
          other such place: its columns are its stages (rider 6), so a view
          document added to it would be listed by a `columns` array the board
          does not draw — the stages are edited from a column's ⋯ instead. */}
        {board === null ? null : (
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
        )}

        {focusDoc === null ? null : (
          <FocusMode
            docId={focusDoc.docId}
            listTitle={focusDoc.columnTitle}
            reveal={focusDoc.reveal}
            onFollow={(docId, reveal) => {
              // Rider 3: a link inside full screen closes it and lands as a
              // loose path at the left edge of the showing board.
              closeFocus();
              applyStrip(openLoose(stripRef.current, docId, reveal));
            }}
            onClose={closeFocus}
            onNotify={notify}
          />
        )}

        {kanbanEdit === null || board === null || board.kanban === null ? null : (
          <KanbanDialog
            mode={kanbanEdit}
            kanban={board.kanban}
            onSubmit={(result) => {
              setKanbanEdit(null);
              void surface.setKanban(
                board,
                result.kanban,
                `“${board.title}” updated — the board document now carries ${String(
                  result.kanban.stages.length,
                )} stages${result.kanban.transitions === undefined ? " and the linear funnel" : " and its own transitions"}.`,
              );
            }}
            onClose={() => {
              setKanbanEdit(null);
            }}
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
    </div>
  );
}
