import { useDocs, type DocsFilter } from "@corpus/kit";
import { useMemo } from "react";
import { compareColumns, toBoardColumn, type BoardColumn } from "./viewDoc";

/**
 * The board's column set: every pinned `type: view` document, in board order
 * (SPEC.md §10).
 *
 * **One bounded request, whatever the board holds.** `pinned=true&type=view&
 * sort=order` returns each view's `query`, `order` and `column` on the row
 * itself (CONTRACT-011), so there is no per-column follow-up read — the design
 * that would otherwise creep in, and the one that turns a ten-column board into
 * eleven requests.
 *
 * Nothing about the column set is hardwired: no title, no query and no position
 * appears in this codebase. A workspace whose view documents were all archived
 * has no columns, and the board says so with its ghost column.
 */

/** The whole column set, in one query. Exported so a test can assert the wire. */
export const PINNED_VIEWS_FILTER: DocsFilter = {
  pinned: true,
  type: "view",
  sort: "order",
};

export interface BoardColumns {
  readonly columns: readonly BoardColumn[];
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useColumns(): BoardColumns {
  const docs = useDocs(PINNED_VIEWS_FILTER);
  const items = docs.data?.items;

  const columns = useMemo(() => (items ?? []).map(toBoardColumn).sort(compareColumns), [items]);

  return { columns, isPending: docs.isPending, error: docs.error };
}
