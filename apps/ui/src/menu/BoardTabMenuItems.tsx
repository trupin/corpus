import type { ReactElement } from "react";
import type { Board } from "../board/boardDoc";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A board tab's acts (`design/navigation.html`'s `boardTabMenu`), each one an
 * edit to the board's own document (SPEC.md §10, rider 2: "a board's lifecycle
 * is its document's: archive, restore, rename and delete act on the file").
 *
 * **Move left/right is the keyboard's half of the tab drag** — the prototype
 * offers both, and the menu is what makes reordering reachable without a
 * pointer (§10 adds no exclusive-pointer capability).
 *
 * **Archive and Delete are refused on the last board**, not hidden: §10 says
 * archiving the last board is refused, and a person who reaches for it deserves
 * the reason rather than a menu that quietly lost an item. The `×` on the tab is
 * the one that disappears, because it is an affordance rather than an answer.
 */

export interface BoardTabMenuItemsProps {
  readonly board: Board;
  /** Where this board sits on the bar, and how many tabs there are. */
  readonly index: number;
  readonly count: number;
  readonly close: () => void;
  readonly onRename: () => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onSetDefault: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}

export function boardTabActions({
  board,
  index,
  count,
  onRename,
  onMove,
  onSetDefault,
  onArchive,
  onDelete,
}: Omit<BoardTabMenuItemsProps, "close">): MenuAction[] {
  const last = count <= 1;
  return [
    {
      id: "rename",
      label: "Rename",
      meta: "edits the board document’s title",
      run: onRename,
    },
    {
      id: "move-left",
      label: "Move left",
      meta: "writes `order` on every board",
      disabled: index === 0,
      run: () => {
        onMove(-1);
      },
    },
    {
      id: "move-right",
      label: "Move right",
      meta: "writes `order` on every board",
      disabled: index >= count - 1,
      run: () => {
        onMove(1);
      },
    },
    {
      id: "default-open",
      label: board.defaultOpen ? "Is the default open target" : "Make it the default open target",
      meta: board.defaultOpen
        ? "already receives every open that names no board"
        : "sets `default-open`; the server clears the others",
      disabled: board.defaultOpen,
      run: onSetDefault,
    },
    {
      id: "archive",
      label: "Archive board",
      meta: last ? "refused — one board is always showing" : "archives it — never deletes",
      disabled: last,
      run: onArchive,
    },
    {
      id: "delete",
      label: "Delete board",
      meta: last
        ? "refused — one board is always showing"
        : "removes the file; the views it listed stay",
      danger: true,
      disabled: last,
      keepOpen: true,
      confirm: {
        label: "Really delete this board? Click again",
        meta: "git still holds it; nothing else does",
      },
      run: onDelete,
    },
  ];
}

export function BoardTabMenuItems({ close, ...rest }: BoardTabMenuItemsProps): ReactElement {
  return <MenuItems actions={boardTabActions(rest)} onDone={close} />;
}
