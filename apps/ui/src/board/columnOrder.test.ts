import { describe, expect, it } from "vitest";
import { nextOrder, ORDER_STEP, planReorder, reinsert, type OrderedColumn } from "./columnOrder";

const board = (...orders: (number | null)[]): OrderedColumn[] =>
  orders.map((order, index) => ({ id: `doc_${String(index)}`, order }));

describe("planReorder", () => {
  it("writes one document when the neighbours leave room", () => {
    // 10, 20, 30, 40 — move the last column between the first two.
    expect(planReorder(board(10, 20, 30, 40), 3, 1)).toEqual([{ id: "doc_3", order: 15 }]);
  });

  it("writes one document when a column moves to either end", () => {
    expect(planReorder(board(10, 20, 30), 2, 0)).toEqual([{ id: "doc_2", order: 0 }]);
    expect(planReorder(board(10, 20, 30), 0, 2)).toEqual([{ id: "doc_0", order: 40 }]);
  });

  it("moves by one position with a single write", () => {
    expect(planReorder(board(10, 20, 30), 1, 2)).toEqual([{ id: "doc_1", order: 40 }]);
    expect(planReorder(board(10, 20, 30, 40), 2, 1)).toEqual([{ id: "doc_2", order: 15 }]);
  });

  it("renumbers the whole board once when no integer fits between the neighbours", () => {
    // Adjacent integers, the gap-exhausted case: 1, 2, 3, 4, 5.
    const writes = planReorder(board(1, 2, 3, 4, 5), 4, 1);
    expect(writes).toEqual([
      { id: "doc_0", order: 10 },
      { id: "doc_4", order: 20 },
      { id: "doc_1", order: 30 },
      { id: "doc_2", order: 40 },
      { id: "doc_3", order: 50 },
    ]);
    // One pass, one write per column, and the gaps are back.
    expect(writes).toHaveLength(5);
  });

  it("keeps a move to the front non-negative, and still writes one document", () => {
    // The seed board is 1, 2, 3 — a step below the first column would be -9.
    expect(planReorder(board(1, 2, 3), 2, 0)).toEqual([{ id: "doc_2", order: 0 }]);
    expect(planReorder(board(5, 6), 1, 0)).toEqual([{ id: "doc_1", order: 2 }]);
    // Already pressed against zero: nowhere left to go but a renumber.
    expect(planReorder(board(0, 10, 20), 2, 0)).toEqual([
      { id: "doc_2", order: 10 },
      { id: "doc_0", order: 20 },
      { id: "doc_1", order: 30 },
    ]);
  });

  it("renumbers rather than guessing when a neighbour carries no order", () => {
    // `doc_0` already sits at 10 and is left alone: a renumber writes the
    // documents whose position actually changed, not all of them.
    expect(planReorder(board(10, null, 30), 2, 1)).toEqual([
      { id: "doc_2", order: 20 },
      { id: "doc_1", order: 30 },
    ]);
    expect(planReorder(board(null, 20), 1, 0)).toEqual([
      { id: "doc_1", order: 10 },
      { id: "doc_0", order: 20 },
    ]);
    expect(planReorder(board(10, null), 0, 1)).toEqual([
      { id: "doc_1", order: 10 },
      { id: "doc_0", order: 20 },
    ]);
    // A missing order on either side of the landing spot, mid-board.
    expect(planReorder(board(null, 10, 20), 2, 1)).toHaveLength(2);
    expect(planReorder(board(10, 20, null), 0, 1)).toHaveLength(3);
  });

  it("renumbers when the stored orders are not ascending", () => {
    // Duplicates, or a hand-edited file: there is no "between" to aim at.
    expect(planReorder(board(30, 20, 10, 40), 3, 2)).toEqual([
      { id: "doc_0", order: 10 },
      { id: "doc_3", order: 30 },
      { id: "doc_2", order: 40 },
    ]);
  });

  it("writes nothing when nothing moves", () => {
    expect(planReorder(board(10, 20, 30), 1, 1)).toEqual([]);
    expect(planReorder(board(10, 20, 30), 0, -1)).toEqual([]);
    expect(planReorder(board(10, 20, 30), 2, 3)).toEqual([]);
    expect(planReorder(board(10, 20, 30), 9, 0)).toEqual([]);
  });

  it("gives the only column on the board the first step", () => {
    expect(planReorder(board(null), 0, 0)).toEqual([]);
    // A one-column board cannot move, but the arithmetic still has an answer.
    expect(planReorder([{ id: "a", order: null }], 0, 0)).toEqual([]);
  });
});

describe("nextOrder", () => {
  it("puts a new column last", () => {
    expect(nextOrder(board(10, 20, 30))).toBe(40);
  });

  it("starts a fresh board at one step", () => {
    expect(nextOrder([])).toBe(ORDER_STEP);
    expect(nextOrder(board(null, null))).toBe(ORDER_STEP);
  });

  it("ignores columns with no order when finding the end", () => {
    expect(nextOrder(board(10, null, 25))).toBe(35);
  });
});

describe("reinsert", () => {
  it("moves one member and leaves the rest in sequence", () => {
    expect(reinsert(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reinsert(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reinsert(["a", "b", "c"], 9, 0)).toEqual(["a", "b", "c"]);
  });
});
