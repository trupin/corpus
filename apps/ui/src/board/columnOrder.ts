/**
 * Column position arithmetic (SPEC.md §10, rider 2 — "adding, removing or
 * reordering a column edits the board document").
 *
 * There is almost nothing left to it, and that is the point. A column's place
 * used to be an `order` number in the view document's own frontmatter, which
 * meant a move was a search for an integer between two neighbours, a
 * renumbering pass when none existed, and a rule about how many documents one
 * gesture was allowed to rewrite. A column's place is now its **index** in the
 * board document's `columns` array, so a move is `reinsert` and one write to one
 * document — and the same view can sit on two boards without either knowing.
 */

/** Moves one member of an array, returning a new array. */
export function reinsert<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const rest = [...items];
  const [moved] = rest.splice(fromIndex, 1);
  if (moved === undefined) return [...items];
  rest.splice(toIndex, 0, moved);
  return rest;
}

/**
 * The board's `columns` after moving one column, or `null` when the gesture
 * changes nothing — which is what makes `⇧←` at the left edge issue zero
 * requests rather than a redundant write.
 */
export function planColumnMove(
  columnIds: readonly string[],
  fromIndex: number,
  toIndex: number,
): readonly string[] | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= columnIds.length) return null;
  if (toIndex < 0 || toIndex >= columnIds.length) return null;
  return reinsert(columnIds, fromIndex, toIndex);
}

/**
 * The board's `columns` with one column removed — **by index, never by id**.
 *
 * A board may list the same view twice (§10 gives no dedupe), and "remove this
 * column" means the one the person is looking at. Filtering by id would take
 * both.
 */
export function planColumnRemoval(
  columnIds: readonly string[],
  index: number,
): readonly string[] | null {
  if (index < 0 || index >= columnIds.length) return null;
  return [...columnIds.slice(0, index), ...columnIds.slice(index + 1)];
}
