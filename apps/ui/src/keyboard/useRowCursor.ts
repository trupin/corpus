import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * The row cursor (SPEC.md §11: `↑`/`↓`, or `j`/`k`, move rows in the active
 * column) — the prototype's `.row.kbd` outline.
 *
 * **The rows are read from the DOM, and that is the honest source here.** The
 * board does not hold the active column's result list; each column fetches its
 * own through `useDocs`, and lifting that back up would mean either a second
 * query or a stream of `onItems` callbacks whose only purpose is to re-derive
 * what is already on screen. What the cursor needs to know is exactly what is
 * *rendered* — a row a column has fetched but not yet painted is not a row the
 * user can move onto — so it counts the painted rows.
 *
 * The consequence is the desirable one for TEST-152: a column whose rows changed
 * under a keystroke clamps against the new count instead of pointing past it.
 */

export interface RowCursor {
  /** The highlighted document in the active column, or `null`. */
  readonly docId: string | null;
  /** The highlighted row element, for the callers that need its dataset. */
  readonly element: () => HTMLElement | null;
  /** Moves and scrolls into view; clamps at both ends, and never wraps. */
  readonly move: (delta: -1 | 1) => void;
}

export interface RowCursorOptions {
  /** The board scroller; the cursor only ever looks inside it. */
  readonly board: RefObject<HTMLElement>;
  readonly activeColumnId: string | null;
}

/** The painted rows of one column, in document order. */
export function columnRows(board: HTMLElement | null, columnId: string | null): HTMLElement[] {
  if (board === null || columnId === null) return [];
  // Column ids are document ids (`doc_…`, contract-shaped), so the quoted
  // attribute form needs no escaping — the same selector `Board.tsx` scrolls by.
  const column = board.querySelector<HTMLElement>(`.col[data-col="${columnId}"]`);
  if (column === null) return [];
  return [...column.querySelectorAll<HTMLElement>(".col-list .row[data-row-doc]")];
}

export function useRowCursor({ board, activeColumnId }: RowCursorOptions): RowCursor {
  const [cursor, setCursor] = useState<{ columnId: string; docId: string } | null>(null);

  /** A cursor belongs to one column; switching columns starts fresh rather than aiming blind. */
  useEffect(() => {
    setCursor((current) =>
      current === null || current.columnId === activeColumnId ? current : null,
    );
  }, [activeColumnId]);

  const element = useCallback((): HTMLElement | null => {
    if (cursor === null) return null;
    return (
      columnRows(board.current, cursor.columnId).find(
        (row) => row.dataset["rowDoc"] === cursor.docId,
      ) ?? null
    );
  }, [board, cursor]);

  const move = useCallback(
    (delta: -1 | 1) => {
      if (activeColumnId === null) return;
      const rows = columnRows(board.current, activeColumnId);
      if (rows.length === 0) return;

      const from =
        cursor === null || cursor.columnId !== activeColumnId
          ? -1
          : rows.findIndex((row) => row.dataset["rowDoc"] === cursor.docId);
      // A first press lands on the first row rather than jumping by one from
      // nowhere: "start at the top" is what an empty cursor means.
      const to = from < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, from + delta));
      const target = rows[to];
      const docId = target?.dataset["rowDoc"];
      if (target === undefined || docId === undefined) return;

      setCursor({ columnId: activeColumnId, docId });
      // jsdom implements no layout and therefore no `scrollIntoView`.
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    },
    [activeColumnId, board, cursor],
  );

  return {
    docId: cursor !== null && cursor.columnId === activeColumnId ? cursor.docId : null,
    element,
    move,
  };
}
