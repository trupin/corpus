import type { ReactElement } from "react";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A column header's acts (SPEC.md §10), each one an edit to a document.
 *
 * **Two documents, and which one each act edits is the point of rider 2.**
 * Rename and Edit query edit the *view* document — the saved query the column
 * renders, which may sit on another board too, and which both boards will see
 * change. "Remove from this board" edits the *board* document: it filters the
 * column out of `columns` and leaves the view exactly where it was, on disk and
 * on every other board that lists it.
 *
 * It replaced "Unpin", which archived the view — the right act while a column
 * *was* a pinned view and the wrong one now, because a view is a saved query and
 * nothing more. Archiving one from here would take it off every board at once,
 * which nobody asked for. The view's own archive is still one act away, in the
 * reader's ⋯ menu, where a document's lifecycle already lives.
 *
 * **A column the board lists and the corpus cannot answer for** offers only the
 * removal: there is no document behind it to rename or re-query, and a menu item
 * that would 404 is worse than one that is absent.
 *
 * **A kanban's stage column is a different set entirely** (SPEC.md §10,
 * rider 6). It has no view document at all: its acts edit the *board*
 * document's `kanban` block — the stages, the transitions, and the order the
 * stages appear in — so there is no Rename, no Edit query and, above all, no
 * "Remove from this board". A stage is not a column somebody added to a board;
 * it is one of the values the board is drawn over, and taking it off is editing
 * `stages`, which is what "Edit the stages…" does.
 *
 * The header's `⋯` and its context menu both render this, so the two cannot
 * offer different sets.
 */

/**
 * The acts of a **derived stage column**, present only on a kanban board.
 *
 * `canMoveLeft`/`canMoveRight` are stated rather than derived here: the menu
 * knows a column, and where a stage sits in `kanban.stages` is the board
 * document's business.
 */
export interface StageColumnActs {
  readonly stage: string;
  readonly field: string;
  readonly canMoveLeft: boolean;
  readonly canMoveRight: boolean;
  readonly onEditStages: () => void;
  readonly onEditTransitions: () => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onOpenBoard: () => void;
}

export interface ColumnMenuItemsProps {
  readonly close: () => void;
  /** No view document answers to this column's id (`BoardColumn.missing`). */
  readonly missing?: boolean;
  /** Set when the column is a kanban stage — a different act set entirely. */
  readonly stage?: StageColumnActs | null;
  readonly onRename: () => void;
  readonly onEditQuery: () => void;
  readonly onRemove: () => void;
}

/** The stage column's `⋯`: every act edits the board document's `kanban` block. */
export function stageColumnActions(stage: StageColumnActs): MenuAction[] {
  return [
    {
      id: "edit-stages",
      label: "Edit the stages…",
      meta: "edits the board document’s `kanban.stages`",
      run: stage.onEditStages,
    },
    {
      id: "edit-transitions",
      label: "Edit the transitions…",
      meta: "blank is the linear funnel",
      run: stage.onEditTransitions,
    },
    {
      id: "move-left",
      label: "Move left",
      meta: "reorders `kanban.stages`",
      disabled: !stage.canMoveLeft,
      run: () => {
        stage.onMove(-1);
      },
    },
    {
      id: "move-right",
      label: "Move right",
      meta: "reorders `kanban.stages`",
      disabled: !stage.canMoveRight,
      run: () => {
        stage.onMove(1);
      },
    },
    {
      id: "open-board",
      label: "Open the board document",
      meta: `the file this ${stage.field} column is drawn from`,
      run: stage.onOpenBoard,
    },
  ];
}

export function columnActions(options: Omit<ColumnMenuItemsProps, "close">): MenuAction[] {
  if (options.stage != null) return stageColumnActions(options.stage);
  const remove: MenuAction = {
    id: "remove",
    label: "Remove from this board",
    meta: "edits the board document — the view stays",
    run: options.onRemove,
  };
  if (options.missing === true) return [remove];
  return [
    {
      id: "rename",
      label: "Rename",
      meta: "edits the view document’s title",
      run: options.onRename,
    },
    {
      id: "edit-query",
      label: "Edit query",
      meta: "edits its stored filters",
      run: options.onEditQuery,
    },
    remove,
  ];
}

export function ColumnMenuItems({ close, ...handlers }: ColumnMenuItemsProps): ReactElement {
  return <MenuItems actions={columnActions(handlers)} onDone={close} />;
}
