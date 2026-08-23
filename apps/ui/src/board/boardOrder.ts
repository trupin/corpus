import { BOARD_ORDER_STEP } from "@corpus/contract";
import { reinsert } from "./columnOrder";

/**
 * Board position arithmetic (SPEC.md §10, rider 2 — "reordering boards writes
 * `order` on every board, in one commit").
 *
 * There is almost nothing left to it, and that is the point. A reorder used to
 * be a renumbering computed here and sent as one `PUT` per board, which is one
 * auto-commit per board — so reverting a drag was several `git revert`s and a
 * sequence that failed partway left half an order in the history. The bar's
 * order now goes to `POST /api/boards/order` as **the sequence of ids**, and the
 * server derives the numbers and lands them as one commit (CONTRACT-080). What
 * is left here is the sequence a drag produces.
 *
 * `nextBoardOrder` stays, because putting a **new** board last is a different
 * question — it is an `order` value on a create, not a statement about the set —
 * and it uses the contract's own step so the two cannot disagree about spacing.
 */

/** Only the two fields the arithmetic reads. `null` order = no `order` key. */
export interface OrderedBoard {
  readonly id: string;
  readonly order: number | null;
}

/**
 * The bar's ids in the order moving `fromIndex` to `toIndex` leaves them, or an
 * empty list when the gesture changes nothing — which is what makes the
 * left-most tab dragged further left issue zero requests.
 */
export function planBoardReorder(
  boards: readonly OrderedBoard[],
  fromIndex: number,
  toIndex: number,
): readonly string[] {
  if (fromIndex === toIndex) return [];
  if (fromIndex < 0 || fromIndex >= boards.length) return [];
  if (toIndex < 0 || toIndex >= boards.length) return [];
  return reinsert(boards, fromIndex, toIndex).map((board) => board.id);
}

/** The `order` a brand-new board takes: last on the bar (SPEC.md §10). */
export function nextBoardOrder(boards: readonly OrderedBoard[]): number {
  const orders = boards
    .map((board) => board.order)
    .filter((order): order is number => order !== null);
  if (orders.length === 0) return BOARD_ORDER_STEP;
  return Math.max(...orders) + BOARD_ORDER_STEP;
}
