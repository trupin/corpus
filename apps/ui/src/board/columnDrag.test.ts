/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { measureColumns, previewOrder, type ColumnBox } from "./columnDrag";

/** Three 100px columns at x = 0, 100, 200; midpoints at 50, 150, 250. */
const BOXES: ColumnBox[] = [
  { id: "a", left: 0, width: 100 },
  { id: "b", left: 100, width: 100 },
  { id: "c", left: 200, width: 100 },
];

const withoutDragged = (draggedId: string): ColumnBox[] =>
  BOXES.filter((box) => box.id !== draggedId);

describe("previewOrder", () => {
  it("inserts before the first column whose midpoint is right of the pointer", () => {
    // Pointer just left of `b`'s midpoint (150) → `c` lands before `b`.
    expect(previewOrder(["a", "b", "c"], "c", withoutDragged("c"), 149)).toEqual(["a", "c", "b"]);
    // Just right of it → after `b`.
    expect(previewOrder(["a", "b", "c"], "c", withoutDragged("c"), 151)).toEqual(["a", "b", "c"]);
  });

  it("puts the column last when the pointer is past every midpoint", () => {
    expect(previewOrder(["a", "b", "c"], "a", withoutDragged("a"), 400)).toEqual(["b", "c", "a"]);
  });

  it("puts the column first when the pointer is left of every midpoint", () => {
    expect(previewOrder(["a", "b", "c"], "c", withoutDragged("c"), 10)).toEqual(["c", "a", "b"]);
  });

  it("ignores a box for the dragged column, as the prototype's :not(.dragging) does", () => {
    // `b`'s own box is present and must not become its own insertion point.
    expect(previewOrder(["a", "b", "c"], "b", BOXES, 400)).toEqual(["a", "c", "b"]);
  });

  it("leaves the order alone when it does not know the dragged column", () => {
    expect(previewOrder(["a", "b"], "zzz", BOXES, 10)).toEqual(["a", "b"]);
  });

  it("leaves the order alone when a measured column is not in it", () => {
    // Mid-refetch: the DOM still holds a column the fetched set has dropped.
    expect(previewOrder(["a", "c"], "c", [{ id: "gone", left: 0, width: 100 }], 10)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("measureColumns", () => {
  it("reads every column card and skips the ghost", () => {
    const board = document.createElement("div");
    board.innerHTML =
      '<section class="col" data-col="doc_a"></section>' +
      '<section class="col" data-col="doc_b"></section>' +
      '<button class="col ghost-col"></button>';
    document.body.append(board);

    expect(measureColumns(board).map((box) => box.id)).toEqual(["doc_a", "doc_b"]);
    board.remove();
  });
});
