import { describe, expect, it } from "vitest";
import {
  BOARD_ORDER_STEP,
  BoardPositionSchema,
  ReorderBoardsRequestSchema,
  ReorderBoardsResultSchema,
} from "./boards.js";

/**
 * The wire half of SPEC.md §10, rider 2: "reordering boards writes `order` on
 * every board, in one commit". What the schemas can be held to is the shape of
 * the ask and the shape of the answer; that the commit is *one* is asserted
 * against real git history in `apps/server/src/docs/board-order.test.ts`, which
 * is the only place it is observable.
 */

describe("ReorderBoardsRequestSchema", () => {
  it("takes the bar as a sequence of ids", () => {
    const parsed = ReorderBoardsRequestSchema.parse({ boards: ["doc_a", "doc_b", "doc_c"] });
    expect(parsed.boards).toEqual(["doc_a", "doc_b", "doc_c"]);
  });

  it("takes a single board, which is a bar of one dragged nowhere", () => {
    expect(ReorderBoardsRequestSchema.safeParse({ boards: ["doc_a"] }).success).toBe(true);
  });

  /** An act on nothing is a caller bug; a `200` naming no board hides a broken bar. */
  it("refuses an empty bar", () => {
    expect(ReorderBoardsRequestSchema.safeParse({ boards: [] }).success).toBe(false);
  });

  /**
   * A board has one position, so a repeat cannot be resolved into an order —
   * and picking one occurrence silently would be a choice about somebody's
   * bar. The message names the id, because that is what the caller has to fix.
   */
  it("refuses an id named twice, naming it", () => {
    const result = ReorderBoardsRequestSchema.safeParse({
      boards: ["doc_a", "doc_b", "doc_a"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("`doc_a` is named twice");
    expect(result.error?.issues[0]?.path).toEqual(["boards", 2]);
  });

  /** Every request body is strict (CONTRACT-017): a typo is a `400` naming the key. */
  it("refuses an unknown key", () => {
    expect(ReorderBoardsRequestSchema.safeParse({ boards: ["doc_a"], order: [1] }).success).toBe(
      false,
    );
  });

  it("refuses something that is not a document id", () => {
    expect(ReorderBoardsRequestSchema.safeParse({ boards: ["board-one"] }).success).toBe(false);
  });
});

describe("ReorderBoardsResultSchema", () => {
  it("carries every named board, the one commit and the warnings", () => {
    const parsed = ReorderBoardsResultSchema.parse({
      boards: [
        { id: "doc_a", order: 1, changed: false },
        { id: "doc_b", order: 2, changed: true },
      ],
      commit: "a1b2c3d",
      warnings: [],
    });
    expect(parsed.commit).toBe("a1b2c3d");
    expect(parsed.boards.map((board) => board.changed)).toEqual([false, true]);
  });

  /**
   * Null is three legitimate outcomes and no error: nothing moved, no git
   * repository, or a hook rejected the commit. A schema that required a sha
   * would make the first of those unreportable.
   */
  it("takes a null commit", () => {
    const parsed = ReorderBoardsResultSchema.parse({
      boards: [{ id: "doc_a", order: 1, changed: false }],
      commit: null,
      warnings: [],
    });
    expect(parsed.commit).toBeNull();
  });

  it("requires a position to say whether it was written", () => {
    expect(BoardPositionSchema.safeParse({ id: "doc_a", order: 1 }).success).toBe(false);
  });

  it("refuses a fractional position: a board sits at a place, not between two", () => {
    expect(BoardPositionSchema.safeParse({ id: "doc_a", order: 1.5, changed: true }).success).toBe(
      false,
    );
  });
});

describe("BOARD_ORDER_STEP", () => {
  /**
   * The one place the spacing is stated. The server renumbers `1 … n` with it
   * and a client puts a new board last at the highest plus one step; two copies
   * of the number is what lets those disagree.
   */
  it("is one, so a renumbered bar reads 1, 2, 3", () => {
    expect(BOARD_ORDER_STEP).toBe(1);
    expect([0, 1, 2].map((index) => (index + 1) * BOARD_ORDER_STEP)).toEqual([1, 2, 3]);
  });
});
