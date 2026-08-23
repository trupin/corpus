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
 * The header's `⋯` and its context menu both render this, so the two cannot
 * offer different sets.
 */

export interface ColumnMenuItemsProps {
  readonly close: () => void;
  /** No view document answers to this column's id (`BoardColumn.missing`). */
  readonly missing?: boolean;
  readonly onRename: () => void;
  readonly onEditQuery: () => void;
  readonly onRemove: () => void;
}

export function columnActions(options: Omit<ColumnMenuItemsProps, "close">): MenuAction[] {
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
