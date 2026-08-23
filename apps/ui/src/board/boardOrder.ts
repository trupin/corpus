import { reinsert } from "./columnOrder";

/**
 * Board position arithmetic (SPEC.md §10, rider 2 — "reordering boards writes
 * `order` on every board, in one commit").
 *
 * `order` is a board's position among boards and nothing else (CONTRACT-074).
 * The rider says a reorder rewrites the set rather than nudging one member, so
 * this is a **renumbering** and not the midpoint search a view's `order` used to
 * get: the bar is a handful of tabs, the numbers people read in
 * `corpus doc show` stay `1, 2, 3`, and there is no state in which the gaps have
 * run out.
 *
 * What is *not* rewritten is a board already sitting at the number the
 * renumbering would give it. Every write is an auto-commit, and a `PUT` that
 * changes nothing still bumps `updated` and lands a line in the log the agent
 * reads (PR #10 finding 19, the rule the view rename has always followed).
 */

/** Spacing of a fresh board bar: consecutive integers, as the seed writes them. */
export const BOARD_ORDER_STEP = 1;

/** What the caller must write, in the order given. Empty means "nothing moved". */
export interface OrderWrite {
  readonly id: string;
  readonly order: number;
}

/** Only the two fields the arithmetic reads. `null` order = no `order` key. */
export interface OrderedBoard {
  readonly id: string;
  readonly order: number | null;
}

/** Every board at its 1-based position, minus the ones already there. */
export function renumberBoards(target: readonly OrderedBoard[]): readonly OrderWrite[] {
  const writes: OrderWrite[] = [];
  for (const [index, board] of target.entries()) {
    const order = (index + 1) * BOARD_ORDER_STEP;
    if (board.order !== order) writes.push({ id: board.id, order });
  }
  return writes;
}

/**
 * The `order` values that realize moving `fromIndex` to `toIndex` in the bar.
 *
 * A move that changes nothing returns no writes — the left-most tab dragged
 * further left issues zero requests.
 */
export function planBoardReorder(
  boards: readonly OrderedBoard[],
  fromIndex: number,
  toIndex: number,
): readonly OrderWrite[] {
  if (fromIndex === toIndex) return [];
  if (fromIndex < 0 || fromIndex >= boards.length) return [];
  if (toIndex < 0 || toIndex >= boards.length) return [];
  return renumberBoards(reinsert(boards, fromIndex, toIndex));
}

/** The `order` a brand-new board takes: last on the bar (SPEC.md §10). */
export function nextBoardOrder(boards: readonly OrderedBoard[]): number {
  const orders = boards
    .map((board) => board.order)
    .filter((order): order is number => order !== null);
  if (orders.length === 0) return BOARD_ORDER_STEP;
  return Math.max(...orders) + BOARD_ORDER_STEP;
}
