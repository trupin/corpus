/**
 * Board position arithmetic (SPEC.md §11 — reordering a column edits its view
 * document's `order`).
 *
 * Two rules, and both exist to keep the *file* honest rather than to keep the
 * code short:
 *
 * 1. **Write the minimum.** Moving one column normally writes one document: the
 *    moved one takes an `order` midway between its new neighbours. Every write
 *    is an auto-commit in the workspace's git history, so a reorder that
 *    rewrites five files to move one is five lines of noise in the log the
 *    agent reads.
 * 2. **Keep `order` an integer.** The contract allows any finite number, but a
 *    view document is read and edited by hand and by the agent; `order: 15` is
 *    a position, `order: 12.6875` is an artefact of the algorithm. Integers are
 *    also what makes "there is no room" a real state rather than a float
 *    epsilon — when no integer separates two neighbours, the board renumbers
 *    once and the gaps come back.
 */

/** Spacing of a fresh or renumbered board: one insert fits between any two. */
export const ORDER_STEP = 10;

/** What the caller must write, in the order given. Empty means "nothing moved". */
export interface OrderWrite {
  readonly id: string;
  readonly order: number;
}

/** Only the two fields the arithmetic reads. `null` order = no `order` key. */
export interface OrderedColumn {
  readonly id: string;
  readonly order: number | null;
}

/** Moves one member of an array, returning a new array. */
export function reinsert<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const rest = [...items];
  const [moved] = rest.splice(fromIndex, 1);
  if (moved === undefined) return [...items];
  rest.splice(toIndex, 0, moved);
  return rest;
}

/** Every column at a fresh multiple of `ORDER_STEP`, minus the ones already there. */
function renumber(target: readonly OrderedColumn[]): OrderWrite[] {
  const writes: OrderWrite[] = [];
  for (const [index, column] of target.entries()) {
    const order = (index + 1) * ORDER_STEP;
    if (column.order !== order) writes.push({ id: column.id, order });
  }
  return writes;
}

/**
 * The `order` values that realize moving `fromIndex` to `toIndex`.
 *
 * Returns the single midpoint write when the neighbours leave an integer
 * between them, and a full renumbering pass when they do not — or when a
 * neighbour carries no `order` at all, since there is nothing to be midway
 * between. A move that changes nothing returns no writes, which is what makes
 * `⇧←` at the left edge issue zero requests rather than a redundant one.
 */
export function planReorder(
  columns: readonly OrderedColumn[],
  fromIndex: number,
  toIndex: number,
): readonly OrderWrite[] {
  if (fromIndex === toIndex) return [];
  const moved = columns[fromIndex];
  if (moved === undefined || toIndex < 0 || toIndex >= columns.length) return [];

  const target = reinsert(columns, fromIndex, toIndex);
  // A move implies at least two columns, so at most one neighbour is absent.
  const before = target[toIndex - 1]?.order ?? null;
  const after = target[toIndex + 1]?.order ?? null;

  if (toIndex === 0) {
    if (after === null) return renumber(target);
    // A step below the first column, unless that would go negative — `order` is
    // a board position, and a file that says `order: -9` reads like a bug even
    // though the contract allows it. Halving keeps it non-negative and still
    // writes one document; only a board already pressed against zero renumbers.
    const spaced = after - ORDER_STEP;
    if (spaced >= 0) return [{ id: moved.id, order: spaced }];
    const halved = Math.floor(after / 2);
    if (halved >= 0 && halved < after) return [{ id: moved.id, order: halved }];
    return renumber(target);
  }

  if (toIndex === target.length - 1) {
    if (before === null) return renumber(target);
    return [{ id: moved.id, order: before + ORDER_STEP }];
  }

  if (before === null || after === null) return renumber(target);
  // Out of ascending order already (duplicates, or a hand-edited file): there is
  // no "between" to aim at, so the board is renumbered rather than guessed at.
  if (before >= after) return renumber(target);

  const midpoint = Math.round((before + after) / 2);
  if (midpoint <= before || midpoint >= after) return renumber(target);
  return [{ id: moved.id, order: midpoint }];
}

/** The `order` a brand-new column takes: last on the board (SPEC.md §11). */
export function nextOrder(columns: readonly OrderedColumn[]): number {
  const orders = columns
    .map((column) => column.order)
    .filter((order): order is number => order !== null);
  if (orders.length === 0) return ORDER_STEP;
  return Math.max(...orders) + ORDER_STEP;
}
