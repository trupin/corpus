import { useDocs, type DocsFilter } from "@corpus/kit";
import { useMemo } from "react";
import type { Board } from "./boardDoc";
import { deriveStageColumns } from "./kanban";
import { missingColumn, toBoardColumn, type BoardColumn } from "./viewDoc";

/**
 * The showing board's columns: its `columns` list, resolved against the
 * workspace's `type: view` documents (SPEC.md §10, rider 2).
 *
 * **The board document decides which columns exist and in what order**; the view
 * documents decide what each one queries and is called. That split is the whole
 * of rider 2: the same view may sit on two boards, a view carries no `pinned`
 * and no `order` any more, and reordering a column edits the board rather than
 * the view.
 *
 * **One bounded request, whatever the board holds.** Every view document is
 * fetched in a single `type=view` query and matched by id, so a ten-column board
 * is one request rather than eleven. The set is small by construction — a
 * workspace has as many view documents as it has saved queries — and it is the
 * same cache entry every board on the bar reads, so switching boards issues
 * nothing.
 *
 * **An id that resolves to nothing is a column, not a gap.** A board listing a
 * view that was archived, deleted or never existed renders §10's error card
 * naming the id ({@link missingColumn}), because a column silently disappearing
 * from a board is how a person loses a list without being told.
 *
 * **A kanban board resolves nothing at all** (SPEC.md §10, rider 6): its columns
 * are its stages, derived from its own `kanban` block and its scope query, and
 * they are not view documents. So the branch below is not an optimisation — a
 * kanban's `columns` is empty by construction, and resolving it would render the
 * board as a board with no columns. The `type=view` query still runs, because it
 * is the same cache entry every other board on the bar reads and a kanban is
 * usually one tab away from one that needs it.
 */

/** Every view document, in one query. Exported so a test can assert the wire. */
export const VIEWS_FILTER: DocsFilter = { type: "view" };

export interface BoardColumns {
  readonly columns: readonly BoardColumn[];
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Resolves one board's columns: its stages when it is a kanban, its `columns`
 * otherwise.
 *
 * `null` — no board is showing at all — is not the same as a board with an empty
 * `columns`: a workspace with no board documents has nothing to resolve against,
 * and the bar is already saying what to do about it.
 */
export function useColumns(board: Board | null): BoardColumns {
  const docs = useDocs(VIEWS_FILTER);
  const items = docs.data?.items;
  const columnIds = board === null || board.kanban !== null ? null : board.columnIds;

  const stages = useMemo(
    () => (board === null || board.kanban === null ? null : deriveStageColumns(board)),
    [board],
  );

  const resolved = useMemo(() => {
    if (columnIds === null) return [];
    const byId = new Map((items ?? []).map((row) => [row.id, row]));
    /*
     * The slot id: the view's id where it appears once, and `<id>#<n>` for a
     * repeat. A board whose file lists the same view twice renders it twice —
     * the file says so, and §10 gives no dedupe — but the two copies are
     * separate places on the board: separate scroll positions, separate readers,
     * separate `data-col`. Sharing one id would make the second column's DOM
     * unaddressable and its local state the first one's.
     */
    const seen = new Map<string, number>();
    return columnIds.map((id) => {
      const count = seen.get(id) ?? 0;
      seen.set(id, count + 1);
      const slot = count === 0 ? id : `${id}#${String(count)}`;
      const row = byId.get(id);
      return row === undefined ? missingColumn(slot, id) : toBoardColumn(slot, row);
    });
  }, [columnIds, items]);

  /*
   * A kanban's columns are ready the moment its board document is: nothing is
   * fetched to derive them, so reporting the view query's `isPending` would show
   * a kanban's empty state for a request its columns do not depend on.
   */
  if (stages !== null) return { columns: stages, isPending: false, error: null };
  return { columns: resolved, isPending: docs.isPending, error: docs.error };
}
