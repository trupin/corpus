import { BOARD_ORDER_STEP } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { nextBoardOrder, planBoardReorder } from "./boardOrder";

const bar = (...orders: (number | null)[]) =>
  orders.map((order, index) => ({ id: `board_${String(index)}`, order }));

describe("planBoardReorder", () => {
  /**
   * SPEC.md §10, rider 2: "reordering boards writes `order` on every board, in
   * one commit". What a drag produces is the **sequence** the bar should be in;
   * the numbers are derived by `POST /api/boards/order`, which is what makes the
   * whole reorder one commit (CONTRACT-080). Computing them here again would be
   * a second opinion about the same rule.
   */
  it("states the bar in the order the drag leaves it", () => {
    expect(planBoardReorder(bar(1, 2, 3, 4), 3, 1)).toEqual([
      "board_0",
      "board_3",
      "board_1",
      "board_2",
    ]);
  });

  it("moves the first board to the end", () => {
    expect(planBoardReorder(bar(1, 2, 3), 0, 2)).toEqual(["board_1", "board_2", "board_0"]);
  });

  /** A board with no `order` key is placed, never dropped. */
  it("names a board carrying no order like any other", () => {
    expect(planBoardReorder(bar(null, 2, 3), 2, 0)).toEqual(["board_2", "board_0", "board_1"]);
  });

  it("asks for nothing when nothing moves", () => {
    expect(planBoardReorder(bar(1, 2, 3), 1, 1)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 0, -1)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 2, 3)).toEqual([]);
    expect(planBoardReorder(bar(1, 2, 3), 9, 0)).toEqual([]);
  });

  /**
   * Two boards at the same `order` — the file is hand-editable (UI-148). The
   * sequence is stated the same way, and the server is what resolves the tie by
   * renumbering; nothing here has to know the bar was inconsistent.
   */
  it("states a bar whose boards share an order like any other", () => {
    expect(planBoardReorder(bar(1, 1, 1), 2, 0)).toEqual(["board_2", "board_0", "board_1"]);
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
