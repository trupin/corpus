import { describe, expect, it } from "vitest";
import { planColumnMove, planColumnRemoval, reinsert } from "./columnOrder";

/**
 * A column's place is its **index** in the board document's `columns`, so the
 * whole of this module is array arithmetic (SPEC.md §10, rider 2). The `order`
 * search that used to live here moved to `boardOrder.ts`, where `order` still
 * means something: a board's position among boards.
 */

const COLUMNS = ["doc_a", "doc_b", "doc_c"];

describe("planColumnMove", () => {
  it("moves one column and leaves the rest in sequence", () => {
    expect(planColumnMove(COLUMNS, 2, 0)).toEqual(["doc_c", "doc_a", "doc_b"]);
    expect(planColumnMove(COLUMNS, 0, 2)).toEqual(["doc_b", "doc_c", "doc_a"]);
    expect(planColumnMove(COLUMNS, 1, 2)).toEqual(["doc_a", "doc_c", "doc_b"]);
  });

  it("writes nothing when nothing moves", () => {
    expect(planColumnMove(COLUMNS, 1, 1)).toBeNull();
    expect(planColumnMove(COLUMNS, 0, -1)).toBeNull();
    expect(planColumnMove(COLUMNS, 2, 3)).toBeNull();
    expect(planColumnMove(COLUMNS, 9, 0)).toBeNull();
  });

  /**
   * A board may list the same view twice (§10 gives no dedupe), and moving one
   * of them must move exactly that entry.
   */
  it("moves one of two entries naming the same view", () => {
    expect(planColumnMove(["doc_a", "doc_b", "doc_a"], 2, 0)).toEqual(["doc_a", "doc_a", "doc_b"]);
  });
});

describe("planColumnRemoval", () => {
  it("removes the entry at the index", () => {
    expect(planColumnRemoval(COLUMNS, 1)).toEqual(["doc_a", "doc_c"]);
    expect(planColumnRemoval(COLUMNS, 0)).toEqual(["doc_b", "doc_c"]);
    expect(planColumnRemoval(COLUMNS, 2)).toEqual(["doc_a", "doc_b"]);
  });

  /** By index, never by id: filtering by id would take both copies. */
  it("removes one of two entries naming the same view", () => {
    expect(planColumnRemoval(["doc_a", "doc_b", "doc_a"], 0)).toEqual(["doc_b", "doc_a"]);
    expect(planColumnRemoval(["doc_a", "doc_b", "doc_a"], 2)).toEqual(["doc_a", "doc_b"]);
  });

  it("answers null for an index the board does not have", () => {
    expect(planColumnRemoval(COLUMNS, -1)).toBeNull();
    expect(planColumnRemoval(COLUMNS, 3)).toBeNull();
    expect(planColumnRemoval([], 0)).toBeNull();
  });
});

describe("reinsert", () => {
  it("moves one member and leaves the rest in sequence", () => {
    expect(reinsert(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reinsert(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reinsert(["a", "b", "c"], 9, 0)).toEqual(["a", "b", "c"]);
  });
});
