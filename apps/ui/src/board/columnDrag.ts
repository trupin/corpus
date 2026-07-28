/**
 * Where a dragged column lands, computed exactly as `design/index.html` does:
 * the first column whose horizontal midpoint is right of the pointer, insert
 * before it — otherwise last, before the ghost column.
 *
 * Kept pure and out of the component because the prototype's version reads the
 * DOM and mutates it in the same expression, which is untestable and, worse,
 * makes the DOM the source of truth for an ordering that lives in documents.
 */

/** One rendered column's horizontal box, in viewport coordinates. */
export interface ColumnBox {
  readonly id: string;
  readonly left: number;
  readonly width: number;
}

/**
 * The board's ids with `draggedId` moved to where the pointer is.
 *
 * `boxes` describes the columns that are *not* being dragged, in their rendered
 * order; a box for the dragged column is ignored, mirroring the prototype's
 * `:not(.dragging)`.
 */
export function previewOrder(
  ids: readonly string[],
  draggedId: string,
  boxes: readonly ColumnBox[],
  clientX: number,
): readonly string[] {
  if (!ids.includes(draggedId)) return ids;
  const rest = ids.filter((id) => id !== draggedId);
  const measurable = boxes.filter((box) => box.id !== draggedId);

  const before = measurable.find((box) => clientX < box.left + box.width / 2);
  const target = before === undefined ? rest.length : rest.indexOf(before.id);
  // A box the current order does not know about (mid-refetch) means "no
  // insertion point": leaving the order alone beats guessing at one.
  if (target < 0) return ids;

  return [...rest.slice(0, target), draggedId, ...rest.slice(target)];
}

/** Reads the boxes straight off the board element, ghost column excluded. */
export function measureColumns(board: HTMLElement): ColumnBox[] {
  const boxes: ColumnBox[] = [];
  for (const element of board.querySelectorAll<HTMLElement>(".col")) {
    // The ghost column carries no `data-col`; nothing inserts after it.
    const id = element.dataset["col"];
    if (id === undefined) continue;
    const rect = element.getBoundingClientRect();
    boxes.push({ id, left: rect.left, width: rect.width });
  }
  return boxes;
}
