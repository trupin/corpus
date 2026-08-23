import { useUpdateDocById } from "@corpus/kit";
import { useCallback } from "react";
import { planColumnMove, planColumnRemoval } from "./columnOrder";

/**
 * Persisting a column change — the one code path the drag, `⇧←`/`⇧→`, the
 * new-list picker and "Remove from this board" all use (SPEC.md §10, rider 2).
 *
 * Every one of them writes **the board document's `columns`**, through
 * `PUT /api/docs/{boardId}`. The view document is not touched: it has no
 * `pinned` and no `order` any more, and the same view may sit on another board
 * that this gesture must not disturb.
 *
 * There is deliberately no second, weaker keyboard path: the prototype reorders
 * the DOM imperatively because it has no data layer, and copying that would
 * leave the board showing a position no document holds. Here the gesture writes,
 * the server auto-commits, and the board re-renders from the refetched board
 * document — which is also why a concurrent out-of-band edit reconciles instead
 * of ghosting.
 */

export interface ColumnWrites {
  /**
   * Moves `fromIndex` to `toIndex` and resolves `true` when a document was
   * written — `false` at either end of the board, which is a silent no-op rather
   * than a redundant write.
   */
  readonly move: (
    boardId: string,
    columnIds: readonly string[],
    fromIndex: number,
    toIndex: number,
  ) => Promise<boolean>;
  /** Appends a view id to the board's list — how a new column comes into being. */
  readonly append: (boardId: string, columnIds: readonly string[], viewId: string) => Promise<void>;
  /** Takes one column off this board by index; the view document is left alone. */
  readonly remove: (
    boardId: string,
    columnIds: readonly string[],
    index: number,
  ) => Promise<boolean>;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useColumnOrder(): ColumnWrites {
  const update = useUpdateDocById();
  const { mutateAsync } = update;

  const write = useCallback(
    async (boardId: string, columns: readonly string[]) => {
      await mutateAsync({ id: boardId, changes: { columns: [...columns] } });
    },
    [mutateAsync],
  );

  const move = useCallback(
    async (
      boardId: string,
      columnIds: readonly string[],
      fromIndex: number,
      toIndex: number,
    ): Promise<boolean> => {
      const next = planColumnMove(columnIds, fromIndex, toIndex);
      if (next === null) return false;
      await write(boardId, next);
      return true;
    },
    [write],
  );

  const append = useCallback(
    async (boardId: string, columnIds: readonly string[], viewId: string): Promise<void> => {
      await write(boardId, [...columnIds, viewId]);
    },
    [write],
  );

  const remove = useCallback(
    async (boardId: string, columnIds: readonly string[], index: number): Promise<boolean> => {
      const next = planColumnRemoval(columnIds, index);
      if (next === null) return false;
      await write(boardId, next);
      return true;
    },
    [write],
  );

  return { move, append, remove, isPending: update.isPending, error: update.error };
}
