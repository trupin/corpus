import type { ReactElement } from "react";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A column header's three acts (SPEC.md §10), each one an edit to the column's
 * own view document.
 *
 * **Unpin archives.** It is not a delete: SPEC.md §9.2 makes deletion user-only
 * and explicit, and archiving is "a reversible flip, never a deletion" — the
 * view document stays on disk, out of the default lists, and can be brought
 * back. A board that destroyed a document when a user tidied a column would be
 * losing work silently.
 *
 * The header's `⋯` and its context menu both render this, so the two cannot
 * offer different sets.
 */

export interface ColumnMenuItemsProps {
  readonly close: () => void;
  readonly onRename: () => void;
  readonly onEditQuery: () => void;
  readonly onUnpin: () => void;
}

export function columnActions(options: Omit<ColumnMenuItemsProps, "close">): MenuAction[] {
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
    {
      id: "unpin",
      label: "Unpin",
      meta: "archives it — never deletes",
      run: options.onUnpin,
    },
  ];
}

export function ColumnMenuItems({ close, ...handlers }: ColumnMenuItemsProps): ReactElement {
  return <MenuItems actions={columnActions(handlers)} onDone={close} />;
}
