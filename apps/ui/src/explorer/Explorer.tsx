import { useCreateDoc, useRenameFolder, useTree, type RowNotice } from "@corpus/kit";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useBoardSurface } from "../board/BoardsProvider";
import { defaultOpenBoard } from "../board/boardDoc";
import { columnRequest } from "../board/newList";
import { EXPLORER_ORIGIN, explorerOriginDoc, openDocsOn } from "../board/strip";
import { useCreateInColumn } from "../board/useCreateInColumn";
import { useOpenInColumn } from "../board/openInColumn";
import { useContextMenu } from "../menu/ContextMenuHost";
import { useToast } from "../shell/Toasts";
import { useExplorer } from "./ExplorerProvider";
import { ExplorerTree } from "./ExplorerTree";
import {
  TreeBoardMenuItems,
  TreeDocMenuItems,
  TreeFolderMenuItems,
  type ExplorerActs,
} from "./explorerMenus";
import { buildTreeRows, type FolderDocs, type TreeRow } from "./treeRows";
import { FolderDocsProbe } from "./FolderDocsProbe";
import "./explorer.css";

/**
 * **Column zero** (SPEC.md §10, rider 1): a retractable panel at the left edge
 * of the board showing the workspace as a tree.
 *
 * **A sibling of the board, never an overlay.** It sits inside `.main` beside
 * `.board-wrap` and takes width from it, exactly as the console drawer takes
 * height — §10's drawer rule. Nothing here is `position: fixed`, and the board
 * scrolls rather than being pushed below a minimum.
 *
 * **Closed is closed.** A retracted explorer renders nothing at all rather than
 * a zero-width panel, so a workspace nobody opened the tree in issues no folder
 * queries at all. The cost is the width transition, which is worth less than a
 * request per folder for a panel that is not on screen.
 *
 * **Where its opens land.** Every open from here goes to the board carrying
 * `default-open` (falling back to the first in `order`), as a **preview path**
 * the next pick replaces — rider 3. Two routes reach that one act: the board's
 * own seam when the target is already showing, which is what scrolls the column
 * in and flashes it, and the board surface when it is not, because a board
 * switch and a strip write in the same handler would otherwise write the path
 * into the board being left.
 */

/** What the head says on the right — the corpus's own size, from the tree. */
export function corpusCountLabel(total: number): string {
  return `${String(total)} doc${total === 1 ? "" : "s"}`;
}

export function Explorer(): ReactElement | null {
  const layout = useExplorer();
  const tree = useTree();
  const surface = useBoardSurface();
  const navigation = useOpenInColumn();
  const contextMenu = useContextMenu();
  const toast = useToast();
  const createInColumn = useCreateInColumn();
  // The view document a folder is pinned as — a different creation from the
  // note "New document here" writes, so a different binding.
  const createDoc = useCreateDoc();
  const renameFolder = useRenameFolder();

  /** One entry per mounted probe — see {@link FolderDocsProbe}. */
  const [answers, setAnswers] = useState<ReadonlyMap<string, FolderDocs>>(new Map());
  const [renaming, setRenaming] = useState<string | null>(null);

  const record = useCallback((path: string, docs: FolderDocs) => {
    setAnswers((held) => {
      if (held.get(path) === docs) return held;
      const next = new Map(held);
      next.set(path, docs);
      return next;
    });
  }, []);

  const notify = useCallback(
    (notice: RowNotice) => {
      toast(notice);
    },
    [toast],
  );

  const boards = surface.boards;
  const currentId = surface.current?.id ?? null;
  const target = useMemo(() => defaultOpenBoard(boards), [boards]);
  const strip = surface.local.strip;

  const open = useCallback(
    (
      docId: string,
      options: {
        readonly keep?: boolean;
        readonly boardId?: string;
        readonly selectTitle?: boolean;
      } = {},
    ) => {
      const boardId = options.boardId ?? target?.id ?? null;
      if (boardId === null) {
        toast({
          tone: "error",
          message: "No board is showing — an open from the tree has nowhere to land.",
        });
        return;
      }
      if (boardId === currentId) {
        navigation.open({
          docId,
          origin: { view: EXPLORER_ORIGIN, doc: docId },
          ...(options.keep === undefined ? {} : { keep: options.keep }),
          ...(options.selectTitle === undefined ? {} : { selectTitle: options.selectTitle }),
        });
        return;
      }
      surface.openFromExplorer(boardId, docId, {
        ...(options.keep === undefined ? {} : { keep: options.keep }),
      });
    },
    [currentId, navigation, surface, target, toast],
  );

  const acts = useMemo<ExplorerActs>(
    () => ({
      defaultBoard: target,
      boards,
      open,
      openFullScreen: (docId) => {
        navigation.openFullScreen(docId, "explorer");
      },
      openBoard: (boardId) => {
        void surface.openBoard(boardId);
      },
      renameFolder: (path) => {
        setRenaming(path);
      },
      createInFolder: (path) => {
        void createInColumn
          .create({ folder: path })
          .then((docId) => {
            open(docId, { selectTitle: true });
          })
          .catch((cause: unknown) => {
            notify({
              tone: "error",
              message: `New document failed — ${cause instanceof Error ? cause.message : "the server refused it"}`,
            });
          });
      },
      pinFolder: (path) => {
        const board = surface.current;
        if (board === null) {
          notify({ tone: "error", message: "No board is showing — a column has nowhere to go." });
          return;
        }
        const name = path.split("/").at(-1) ?? path;
        void createDoc
          .mutateAsync(
            columnRequest({
              key: `folder:${path}`,
              source: "folder",
              title: name,
              query: { folder: path },
              detail: path,
            }),
          )
          .then(async (response) => {
            await surface.addColumn(response.doc.frontmatter.id);
            notify({
              tone: "info",
              message: `Pinned ${path}/ on “${board.title}” — a view document was created and listed on the board.`,
            });
          })
          .catch((cause: unknown) => {
            notify({
              tone: "error",
              message: `Pin as a column failed — ${cause instanceof Error ? cause.message : "the server refused it"}`,
            });
          });
      },
      notify,
    }),
    [boards, createDoc, createInColumn, navigation, notify, open, surface, target],
  );

  const folders = tree.data?.folders ?? [];
  const rows = useMemo(
    () =>
      buildTreeRows({
        folders,
        docsByFolder: answers,
        isExpanded: layout.isExpanded,
        openDocs: openDocsOn(strip),
        originDoc: explorerOriginDoc(strip),
        currentBoardId: currentId,
      }),
    [answers, currentId, folders, layout, strip],
  );

  /** Every folder currently drawn open — one probe each, and none while closed. */
  const expanded = useMemo(
    () =>
      rows
        .filter((row): row is Extract<TreeRow, { kind: "folder" }> => row.kind === "folder")
        .filter((row) => !row.collapsed)
        .map((row) => row.path),
    [rows],
  );

  const openMenu = useCallback(
    (row: TreeRow, clientX: number, clientY: number, autoFocus: boolean) => {
      if (row.kind === "folder") {
        contextMenu.open({
          label: `Folder options for ${row.path}`,
          clientX,
          clientY,
          autoFocus,
          items: (close) => (
            <TreeFolderMenuItems path={row.path} count={row.count} acts={acts} close={close} />
          ),
        });
        return;
      }
      if (row.kind !== "doc") return;
      if (row.type === "board") {
        contextMenu.open({
          label: `Board options for ${row.title}`,
          clientX,
          clientY,
          autoFocus,
          items: (close) => (
            <TreeBoardMenuItems
              board={{ id: row.id, title: row.title, archived: row.archived }}
              acts={acts}
              close={close}
            />
          ),
        });
        return;
      }
      contextMenu.open({
        label: `Actions for ${row.title}`,
        clientX,
        clientY,
        autoFocus,
        items: (close) => (
          <TreeDocMenuItems
            subject={{
              id: row.id,
              title: row.title,
              type: row.type,
              status: row.status,
              folder: row.folder,
              staleLevel: row.staleLevel,
            }}
            acts={acts}
            close={close}
          />
        ),
      });
    },
    [acts, contextMenu],
  );

  const applyRename = useCallback(
    (path: string, next: string | null) => {
      setRenaming(null);
      const name = next?.trim() ?? "";
      const current = path.split("/").at(-1) ?? path;
      if (next === null || name === "" || name === current) return;
      const parent = path.slice(0, path.length - current.length);
      const to = `${parent}${name}`;
      void renameFolder
        .mutateAsync({ from: path, to })
        .then((result) => {
          toast({
            tone: "info",
            message:
              `Renamed ${path}/ to ${to}/ — committed. ${String(result.documents.length)} ` +
              `document${result.documents.length === 1 ? "" : "s"} moved with it; every id is unchanged.`,
          });
        })
        .catch((cause: unknown) => {
          toast({
            tone: "error",
            message: `Rename folder failed — ${cause instanceof Error ? cause.message : "the server refused it"}`,
          });
        });
    },
    [renameFolder, toast],
  );

  if (!layout.open) return null;

  const total = folders.reduce((sum, node) => sum + node.totalCount, 0);

  return (
    <aside
      className="explorer"
      style={{ width: `${String(layout.width)}px` }}
      aria-label="Explorer"
    >
      <div className="explorer-head">
        <span>corpus</span>
        <span className="n" title="Every document the folder tree counts">
          {tree.isPending ? "…" : corpusCountLabel(total)}
        </span>
      </div>

      {expanded.map((path) => (
        <FolderDocsProbe key={path} path={path} onAnswer={record} />
      ))}

      {tree.error === null ? (
        <ExplorerTree
          rows={rows}
          renaming={renaming}
          onRename={applyRename}
          acts={{
            activate: (row: TreeRow) => {
              if (row.kind === "folder") {
                layout.toggleFolder(row.path);
                return;
              }
              if (row.kind !== "doc") return;
              // A `type: board` row **is** the board (rider 1).
              if (row.type === "board") void surface.openBoard(row.id);
              else open(row.id);
            },
            keep: (row: TreeRow) => {
              if (row.kind !== "doc") return;
              if (row.type === "board") void surface.openBoard(row.id);
              else open(row.id, { keep: true });
            },
            toggleFolder: layout.toggleFolder,
            menu: openMenu,
          }}
        />
      ) : (
        <p className="tree-note tree-error" role="alert">
          The folder tree could not be loaded — {tree.error.message}
        </p>
      )}

      {/*
       * The drag handle, and a keyboard one (SPEC.md §10: an affordance a
       * pointer reaches must be reachable without one). `separator` with an
       * orientation is what a resizer between two regions is.
       */}
      <div
        className={`explorer-resizer${layout.dragging ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize explorer"
        tabIndex={0}
        onPointerDown={layout.onResizerPointerDown}
        onKeyDown={layout.onResizerKeyDown}
      />
    </aside>
  );
}
