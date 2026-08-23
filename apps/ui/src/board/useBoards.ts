import { useDocs, type DocsFilter } from "@corpus/kit";
import { useMemo } from "react";
import { compareBoards, toBoard, type Board } from "./boardDoc";

/**
 * Every board, in bar order (SPEC.md §10, rider 2).
 *
 * **The whole board bar in one request.** `type=board&sort=order` returns each
 * board's `columns`, `kanban`, `defaultOpen`, `order` and `query` on the row
 * itself (CONTRACT-074), so the bar costs one query however many boards a
 * workspace holds — and a board's columns are known before its tab is clicked.
 * There is deliberately no per-board follow-up read here.
 *
 * Archived boards are excluded by the collection's own default (SPEC.md §10), so
 * an archived board leaves the bar and stays in the corpus — which is what makes
 * the explorer's "restore it first, then show it" (UI-150) a real act rather
 * than an undelete.
 */

/** The whole board set, in one query. Exported so a test can assert the wire. */
export const BOARDS_FILTER: DocsFilter = { type: "board", sort: "order" };

export interface Boards {
  readonly boards: readonly Board[];
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useBoards(): Boards {
  const docs = useDocs(BOARDS_FILTER);
  const items = docs.data?.items;

  const boards = useMemo(() => (items ?? []).map(toBoard).sort(compareBoards), [items]);

  return { boards, isPending: docs.isPending, error: docs.error };
}
