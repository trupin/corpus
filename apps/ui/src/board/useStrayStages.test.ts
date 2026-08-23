import { describe, expect, it } from "vitest";
import type { Board } from "./boardDoc";
import { strayCounts } from "./useStrayStages";

const board = (overrides: Partial<Board> = {}): Board => ({
  id: "board_k",
  title: "House hunt",
  order: 1,
  columnIds: [],
  kanban: { field: "stage", stages: ["a", "b", "c"] },
  defaultOpen: false,
  query: { tag: "housing" },
  width: null,
  ...overrides,
});

describe("strayCounts", () => {
  it("is one subtraction for a kanban over `stage` — two `limit=1` requests", () => {
    expect(strayCounts(board())).toEqual([
      { filter: { tag: "housing", includeArchived: true, limit: 1 }, sign: 1 },
      {
        filter: { tag: "housing", includeArchived: true, limit: 1, stage: ",a,b,c" },
        sign: -1,
      },
    ]);
  });

  it("counts archived documents in scope, per SPEC.md §5", () => {
    expect(strayCounts(board())[0]?.filter["includeArchived"]).toBe(true);
  });

  it("asks only about the statuses a `status` kanban does not list", () => {
    const counts = strayCounts(
      board({ kanban: { field: "status", stages: ["open", "resolved"] }, query: null }),
    );
    expect(counts).toEqual([{ filter: { status: "archived", limit: 1 }, sign: 1 }]);
  });

  it("asks nothing at all of a `status` kanban listing all three", () => {
    expect(
      strayCounts(board({ kanban: { field: "status", stages: ["open", "resolved", "archived"] } })),
    ).toEqual([]);
  });

  it("asks nothing of a board that is not a kanban", () => {
    expect(strayCounts(board({ kanban: null }))).toEqual([]);
    expect(strayCounts(null)).toEqual([]);
  });
});
