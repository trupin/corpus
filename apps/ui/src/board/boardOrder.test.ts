import { describe, expect, it } from "vitest";
import { BOARD_ORDER_STEP, nextBoardOrder, planBoardReorder, renumberBoards } from "./boardOrder";

const bar = (...orders: (number | null)[]) =>
  orders.map((order, index) => ({ id: `board_${String(index)}`, order }));

describe("planBoardReorder", () => {
  /**
   * SPEC.md §10, rider 2: "reordering boards writes `order` on every board".
   * Every board that ends up at a new position is written, and one already
   * sitting at the number it would be given is not — a `PUT` that changes
   * nothing still lands a commit.
   */
  it("renumbers the boards whose position changed", () => {
    expect(planBoardReorder(bar(1, 2, 3, 4), 3, 1)).toEqual([
      { id: "board_3", order: 2 },
      { id: "board_1", order: 3 },
      { id: "board_2", order: 4 },
    ]);
  });

  it("writes every board when the first one moves to the end", () => {
    expect(planBoardReorder(bar(1, 2, 3), 0, 2)).toEqual([
      { id: "board_1", order: 1 },
      { id: "board_2", order: 2 },
      { id: "board_0", order: 3 },
    ]);
  });

  /** A board with no `order` key is placed, never dropped. */
  it("gives a board carrying no order a number", () => {
    expect(planBoardReorder(bar(null, 2, 3), 2, 0)).toEqual([
      { id: "board_2", order: 1 },
      { id: "board_0", order: 2 },
      { id: "board_1", order: 3 },
    ]);
  });

  it("writes nothing when nothing moves", () => {
    expect(planBoardReorder(bar(1, 2, 3), 1, 1)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 0, -1)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 2, 3)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 9, 0)).toEqual([]);
  });

  /** Two boards at the same `order` — the file is hand-editable (UI-148). */
  it("resolves a bar whose boards share an order", () => {
    // `board_2` lands first and is already at 1, so only the two it displaced
    // are written.
    expect(planBoardReorder(bar(1, 1, 1), 2, 0)).toEqual([
      { id: "board_0", order: 2 },
      { id: "board_1", order: 3 },
    ]);
  });
});

describe("renumberBoards", () => {
  it("skips a board already at the number it would be given", () => {
    expect(renumberBoards(bar(1, 2, 3))).toEqual([]);
    expect(renumberBoards(bar(1, 5, 3))).toEqual([{ id: "board_1", order: 2 }]);
  });
});

describe("nextBoardOrder", () => {
  it("puts a new board last", () => {
    expect(nextBoardOrder(bar(1, 2, 3))).toBe(4);
  });

  it("starts a fresh bar at one step", () => {
    expect(nextBoardOrder([])).toBe(BOARD_ORDER_STEP);
    expect(nextBoardOrder(bar(null, null))).toBe(BOARD_ORDER_STEP);
  });

  it("ignores boards with no order when finding the end", () => {
    expect(nextBoardOrder(bar(1, null, 7))).toBe(8);
  });
});
