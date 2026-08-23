import {
  useDeleteFolder,
  useSetFolderArchived,
  type RowNotice,
  type StalenessLevel,
} from "@corpus/kit";
import type { ReactElement } from "react";
import { useBoardSurface } from "../board/BoardsProvider";
import type { Board } from "../board/boardDoc";
import { useDocActions, type BoardTarget } from "../menu/docActions";
import { MenuItems } from "../menu/MenuItems";
import type { MenuAction } from "../menu/menuModel";

/**
 * The explorer's three menus (SPEC.md §10, rider 1: "a right click offers the
 * document's existing actions and a choice of board. A folder's menu offers the
 * folder acts of §9.2").
 *
 * **Nothing here is a second implementation of a document act.** Archive,
 * unarchive, resolve and delete come from `useDocActions`, which is the one
 * declaration the reader's ⋯ and the board row's menu also render — so a tree
 * row and a list row can never disagree about what Archive does. What this
 * module adds is the two things only the explorer has: an open that lands on a
 * *chosen board* as a preview, and acts whose subject is a **folder**.
 */

/** What the tree can ask of the board, handed down by `Explorer`. */
export interface ExplorerActs {
  /** The board that receives an open naming none — `default-open`, else the first. */
  readonly defaultBoard: Board | null;
  readonly boards: readonly Board[];
  /** Open as a preview path; `keep` detaches it on arrival (the double click). */
  readonly open: (
    docId: string,
    options?: {
      readonly keep?: boolean;
      readonly boardId?: string;
      readonly selectTitle?: boolean;
    },
  ) => void;
  readonly openFullScreen: (docId: string) => void;
  /** A `type: board` row **is** the board: show it, restoring it first if archived. */
  readonly openBoard: (boardId: string) => void;
  /** Starts the inline rename on a folder row. */
  readonly renameFolder: (path: string) => void;
  /** Creates a document into this folder and opens it with its title selected. */
  readonly createInFolder: (path: string) => void;
  /** Creates a `folder:` view document and appends it to the showing board. */
  readonly pinFolder: (path: string) => void;
  readonly notify: (notice: RowNotice) => void;
}

/** What a tree row knows about the document it draws. */
export interface TreeDocSubject {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly folder: string;
  readonly staleLevel: StalenessLevel;
}

export interface TreeDocMenuItemsProps {
  readonly subject: TreeDocSubject;
  readonly acts: ExplorerActs;
  readonly close: () => void;
}

/**
 * An ordinary document's row in the tree.
 *
 * The open items are the explorer's own — a preview on the default board, the
 * same preview kept, full screen, and one item per **other** board — and
 * everything below them is the shared declaration. "Open here" is absent, and
 * deliberately: it means "in this column's own reader", and the tree is not a
 * column.
 */
export function TreeDocMenuItems({ subject, acts, close }: TreeDocMenuItemsProps): ReactElement {
  const target = acts.defaultBoard;
  const others: readonly BoardTarget[] = acts.boards
    .filter((board) => board.id !== target?.id)
    .map((board) => ({
      id: board.id,
      title: board.title,
      open: () => {
        acts.open(subject.id, { boardId: board.id });
      },
    }));

  const actions = useDocActions(subject, {
    surface: "row",
    onNotify: acts.notify,
    close,
    onOpen: () => {
      acts.open(subject.id);
    },
    openLabel: {
      label: target === null ? "Open" : `Open in ${target.title}`,
      meta: "a preview path — the next pick replaces it (↵)",
    },
    onOpenAndKeep: () => {
      acts.open(subject.id, { keep: true });
    },
    onOpenFocus: () => {
      acts.openFullScreen(subject.id);
    },
    boardTargets: others,
  });

  return <MenuItems actions={actions} onDone={close} />;
}

export interface TreeBoardMenuItemsProps {
  readonly board: { readonly id: string; readonly title: string; readonly archived: boolean };
  readonly acts: ExplorerActs;
  readonly close: () => void;
}

/**
 * A `type: board` row (rider 1: "a `type: board` document in the tree **is** the
 * board: clicking it shows that board, restoring it first if it was archived").
 *
 * So the first item is the board and the second is its *document* — the same
 * distinction the board bar's own tab menu draws. The lifecycle items are the
 * board surface's, not `useDocActions`', because archiving the last board is
 * refused with a sentence and a plain document archive would not know that.
 */
export function TreeBoardMenuItems({ board, acts, close }: TreeBoardMenuItemsProps): ReactElement {
  const surface = useBoardSurface();
  const live = surface.boards.find((entry) => entry.id === board.id) ?? null;

  const actions: MenuAction[] = [
    {
      id: "open-board",
      label: board.archived ? "Restore and open the board" : "Open the board",
      meta: board.archived ? "unarchives it, then shows it (↵)" : "shows it on the bar (↵)",
      run: () => {
        acts.openBoard(board.id);
      },
    },
    {
      id: "open-board-doc",
      label: "Open the board document",
      meta: "the file that lists its columns — a preview path",
      run: () => {
        acts.open(board.id);
      },
    },
  ];

  if (board.archived) {
    actions.push({
      id: "restore-board",
      label: "Restore",
      meta: "back on the bar, without showing it",
      run: () => {
        void surface.openBoard(board.id);
      },
    });
  } else if (live !== null) {
    actions.push({
      id: "archive-board",
      label: "Archive board",
      meta: "reversible — it stays in the corpus, under boards/",
      run: () => {
        void surface.archiveBoard(live);
      },
    });
  }

  actions.push({
    id: "delete-board",
    label: "Delete board…",
    meta: "user-only · click twice to confirm",
    danger: true,
    confirm: {
      label: "Really delete this board? Click again",
      meta: "permanent · git keeps history · the view documents it listed are untouched",
    },
    keepOpen: true,
    disabled: live === null,
    run: () => {
      if (live === null) return;
      void surface.deleteBoard(live);
      close();
    },
  });

  return <MenuItems actions={actions} onDone={close} />;
}

/** What the folder's delete confirmation says. One sentence, so its test can name it. */
export function folderDeleteMeta(path: string, count: number): string {
  return (
    `permanent · the tree counts ${String(count)} document${count === 1 ? "" : "s"} under ${path}/ · ` +
    "git keeps history · threads on them survive as orphaned records"
  );
}

export interface TreeFolderMenuItemsProps {
  readonly path: string;
  /** `totalCount` from `GET /api/tree` — what the row already shows. */
  readonly count: number;
  readonly acts: ExplorerActs;
  readonly close: () => void;
}

/**
 * A folder row (SPEC.md §9.2's folder acts, rider 7).
 *
 * **The count in the confirmation is the tree's, and says so.** The delete
 * response names the documents it removed and does *not* name the threads it
 * orphaned (SERVER-136), so no confirmation here can promise the total. It
 * quotes the number the row is already showing and states the thread rule
 * separately, which is the honest pair.
 */
export function TreeFolderMenuItems({
  path,
  count,
  acts,
  close,
}: TreeFolderMenuItemsProps): ReactElement {
  const setArchived = useSetFolderArchived();
  const deleteFolder = useDeleteFolder();

  const actions: MenuAction[] = [
    {
      id: "new-doc",
      label: "New document here",
      meta: `creates into ${path}/, title selected`,
      run: () => {
        acts.createInFolder(path);
      },
    },
    {
      id: "pin-folder",
      label: "Pin as a column on this board",
      meta: "writes a view document and lists it on the board",
      run: () => {
        acts.pinFolder(path);
      },
    },
    {
      id: "rename-folder",
      label: "Rename folder…",
      meta: "moves every document under it; ids never change",
      run: () => {
        acts.renameFolder(path);
      },
    },
    {
      id: "archive-folder",
      label: "Archive folder",
      meta: "flips every document in it — it moves nothing",
      disabled: setArchived.isPending,
      run: () => {
        void setArchived
          .mutateAsync({ path, archived: true })
          .then((result) => {
            acts.notify({
              tone: "info",
              message: folderStatusNotice(path, result.documents.length, true),
            });
          })
          .catch((cause: unknown) => {
            acts.notify({ tone: "error", message: `Archive folder failed — ${reason(cause)}` });
          });
      },
    },
    {
      id: "unarchive-folder",
      label: "Unarchive folder",
      meta: "restores every archived document in it",
      disabled: setArchived.isPending,
      run: () => {
        void setArchived
          .mutateAsync({ path, archived: false })
          .then((result) => {
            acts.notify({
              tone: "info",
              message: folderStatusNotice(path, result.documents.length, false),
            });
          })
          .catch((cause: unknown) => {
            acts.notify({ tone: "error", message: `Unarchive folder failed — ${reason(cause)}` });
          });
      },
    },
    {
      id: "delete-folder",
      label: "Delete folder…",
      meta: "user-only · click twice to confirm",
      danger: true,
      disabled: deleteFolder.isPending,
      confirm: {
        label: `Really delete ${path}/? Click again`,
        meta: folderDeleteMeta(path, count),
      },
      // The request can be refused, so this item owns its own close: a menu that
      // had already gone would leave the refusal with nothing to re-arm.
      keepOpen: true,
      run: (disarm) => {
        void deleteFolder
          .mutateAsync(path)
          .then((result) => {
            acts.notify({
              tone: "info",
              message: folderDeleteNotice(path, result.documents.length),
            });
            close();
          })
          .catch((cause: unknown) => {
            acts.notify({ tone: "error", message: `Delete folder failed — ${reason(cause)}` });
            disarm();
          });
      },
    },
  ];

  return <MenuItems actions={actions} onDone={close} />;
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : "the server refused it";
}

/**
 * What a folder archive narrates.
 *
 * The count is **what the server listed**, and the sentence says so rather than
 * saying "changed": `documents` is the state after the act, so a folder whose
 * documents were already archived reports all of them (SERVER-136).
 */
export function folderStatusNotice(path: string, listed: number, archived: boolean): string {
  const verb = archived ? "Archived" : "Restored";
  return (
    `${verb} ${path}/ — committed. The server listed ${String(listed)} document` +
    `${listed === 1 ? "" : "s"} in the folder afterwards; nothing moved on disk.`
  );
}

/**
 * What a folder deletion narrates — and what it deliberately does not claim.
 *
 * The response names the documents it removed. It names no threads, and the
 * folder itself may still be there if it held something that is not a document
 * (SERVER-136), so neither is asserted here.
 */
export function folderDeleteNotice(path: string, removed: number): string {
  return (
    `Deleted ${String(removed)} document${removed === 1 ? "" : "s"} under ${path}/ — user-only ` +
    "act; git retains their history. Threads on them survive as orphaned records."
  );
}
