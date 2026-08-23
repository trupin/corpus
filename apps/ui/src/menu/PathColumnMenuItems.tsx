import type { ReactElement } from "react";
import { useMaybeBoardSurface } from "../board/BoardsProvider";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A path column's own acts (SPEC.md §10, rider 3), the prototype's
 * `pathColMenu`: restart the path here, a new path to the right, keep —
 * detach from its origin, close this column and after, close the whole path —
 * plus full screen and "open in… <boards>". Offered from the column's ⋯ and
 * from right-clicking its head; the **document's** actions stay on the reader's
 * own ⋯ menu below, which the column mounts unchanged.
 */

export interface PathColumnMenuItemsProps {
  /** The document this column is showing — full screen's and "open in…"'s subject. */
  readonly docId: string;
  /** Whether the path still hangs off an origin row. */
  readonly hasOrigin: boolean;
  /** This column's index in its path — 0 is the root. */
  readonly index: number;
  readonly close: () => void;
  readonly onFocusMode: () => void;
  readonly onRestartHere: () => void;
  readonly onNewPathRight: () => void;
  readonly onDetach: () => void;
  readonly onCloseAfter: () => void;
  readonly onCloseWholePath: () => void;
}

export function PathColumnMenuItems({
  docId,
  hasOrigin,
  index,
  close,
  onFocusMode,
  onRestartHere,
  onNewPathRight,
  onDetach,
  onCloseAfter,
  onCloseWholePath,
}: PathColumnMenuItemsProps): ReactElement {
  const boards = useMaybeBoardSurface();

  const actions: MenuAction[] = [
    {
      id: "focus",
      label: "Open in full screen",
      meta: "the overlay (f)",
      run: onFocusMode,
    },
    {
      id: "restart",
      label: "Restart the path here",
      meta: "this document becomes the root of a loose path",
      // A loose path's root is already exactly that — the act would change
      // nothing, and a menu item that does nothing is disabled with its reason
      // in the label's own terms (the prototype mutes it).
      disabled: !hasOrigin && index === 0,
      run: onRestartHere,
    },
    {
      id: "new-right",
      label: "New path to the right",
      meta: "a loose path rooted at this document",
      run: onNewPathRight,
    },
    ...(hasOrigin
      ? [
          {
            id: "detach",
            label: "Keep — detach from its origin",
            meta: "the next pick from its origin row opens a new path",
            run: onDetach,
          } satisfies MenuAction,
        ]
      : []),
    {
      id: "close-after",
      label: "Close this column and after",
      meta: "everything to its right goes with it (esc)",
      run: onCloseAfter,
    },
    {
      id: "close-path",
      label: "Close the whole path",
      meta: "every column of this path",
      run: onCloseWholePath,
    },
    ...(boards === null
      ? []
      : boards.boards
          .filter((board) => board.id !== boards.current?.id)
          .map(
            (board) =>
              ({
                id: `open-in-board:${board.id}`,
                label: `Open in ${board.title}`,
                meta: "a loose path at that board’s left edge",
                run: () => {
                  boards.openOnBoard(board.id, docId);
                },
              }) satisfies MenuAction,
          )),
  ];

  return <MenuItems actions={actions} onDone={close} />;
}
