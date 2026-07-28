import { useUpdateDocById } from "@corpus/kit";
import { useCallback } from "react";
import { planReorder, type OrderedColumn } from "./columnOrder";

/**
 * Persisting a reorder — the one code path both the drag and `⇧←`/`⇧→` use
 * (SPEC.md §11, §15 M3).
 *
 * There is deliberately no second, weaker keyboard path: the prototype reorders
 * the DOM imperatively because it has no data layer, and copying that would
 * leave the board showing a position no document holds. Here the gesture writes
 * `order` through `PUT /api/docs/{id}`, the server auto-commits, and the board
 * re-renders from the refetched-and-sorted column set — which is also why a
 * concurrent out-of-band reorder reconciles instead of ghosting.
 */

export interface ColumnOrderMutation {
  /**
   * Moves `fromIndex` to `toIndex` and resolves with the number of documents
   * written — zero at either end of the board, which is a silent no-op rather
   * than a redundant write.
   */
  readonly move: (
    columns: readonly OrderedColumn[],
    fromIndex: number,
    toIndex: number,
  ) => Promise<number>;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useColumnOrder(): ColumnOrderMutation {
  const update = useUpdateDocById();
  const { mutateAsync } = update;

  const move = useCallback(
    async (columns: readonly OrderedColumn[], fromIndex: number, toIndex: number) => {
      const writes = planReorder(columns, fromIndex, toIndex);
      // Sequential rather than parallel: the server is the sole writer and each
      // write is its own commit, so a deterministic order keeps the git history
      // readable and keeps a partial failure from interleaving.
      for (const write of writes) {
        await mutateAsync({ id: write.id, changes: { order: write.order } });
      }
      return writes.length;
    },
    [mutateAsync],
  );

  return { move, isPending: update.isPending, error: update.error };
}
