import type { DocRow } from "@corpus/contract";
import { stalenessLevel, type RowNotice, type StalenessLevel } from "@corpus/kit";
import type { ReactElement } from "react";
import { useMaybeBoardSurface } from "../board/BoardsProvider";
import { useDocActions, type BoardTarget } from "./docActions";
import { MenuItems } from "./MenuItems";

/**
 * A list row's own actions (SPEC.md §10): open · open in focus · archive ·
 * delete · resolve/reopen · the staleness quick actions where they are already
 * shown.
 *
 * `hasStaleActions` is consulted rather than duplicated (through
 * {@link useDocActions}), so the row's rendered quick-action group and this
 * menu can never disagree about whether a row is at the last rung.
 */

/** What a row menu needs to know, however the caller learned it. */
export interface RowSubject {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly staleLevel: StalenessLevel;
}

export function subjectFromRow(row: DocRow): RowSubject {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    staleLevel: stalenessLevel(row.stale),
  };
}

/**
 * The same subject, read back off the painted row.
 *
 * The keyboard path (⇧F10 / the menu key) knows only which element is
 * highlighted — the board does not hold the active column's result set, each
 * column fetches its own — so the row's own data attributes are the honest
 * source, exactly as `useRowCursor` and the `e` binding already read them.
 */
export function subjectFromElement(element: HTMLElement): RowSubject | null {
  const id = element.dataset["rowDoc"];
  if (id === undefined || id === "") return null;
  const level = Number(element.dataset["rowLevel"] ?? "0");
  return {
    id,
    title: element.querySelector(".row-title")?.textContent ?? id,
    type: element.dataset["rowType"] ?? "note",
    status: element.dataset["rowStatus"] ?? "open",
    staleLevel: (level === 1 || level === 2 || level === 3 ? level : 0) satisfies StalenessLevel,
  };
}

export interface RowMenuItemsProps {
  readonly subject: RowSubject;
  readonly close: () => void;
  /** Open — a path off this row (SPEC.md §10, rider 3). */
  readonly onOpen: () => void;
  /** Open here — the column's own in-place reader. */
  readonly onOpenHere: () => void;
  readonly onOpenFocus: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function RowMenuItems({
  subject,
  close,
  onOpen,
  onOpenHere,
  onOpenFocus,
  onNotify,
}: RowMenuItemsProps): ReactElement {
  /*
   * "open in… <boards>" (rider 3) — one item per board that is not showing,
   * each landing the document as a loose path at that board's left edge. Read
   * through the tolerant accessor: a menu rendered outside the provider (a
   * component test) simply offers no board items, which is also the honest
   * answer for a workspace with one board.
   */
  const boards = useMaybeBoardSurface();
  const boardTargets: readonly BoardTarget[] =
    boards === null
      ? []
      : boards.boards
          .filter((board) => board.id !== boards.current?.id)
          .map((board) => ({
            id: board.id,
            title: board.title,
            open: () => {
              boards.openOnBoard(board.id, subject.id);
            },
          }));

  const actions = useDocActions(subject, {
    surface: "row",
    onNotify,
    close,
    onOpen,
    onOpenHere,
    onOpenFocus,
    boardTargets,
  });
  return <MenuItems actions={actions} onDone={close} />;
}
