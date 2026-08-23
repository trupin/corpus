import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import { compareBoards, resolveBoard, toBoard, type Board } from "./boardDoc";

const row = (overrides: Parameters<typeof docRowFixture>[0] = {}) =>
  docRowFixture({ type: "board", ...overrides });

const board = (overrides: Partial<Board> = {}): Board => ({
  id: "board_a",
  title: "Attention",
  order: 1,
  columnIds: [],
  kanban: null,
  defaultOpen: false,
  query: null,
  ...overrides,
});

describe("toBoard", () => {
  it("reads the board keys off the row (CONTRACT-074)", () => {
    expect(
      toBoard(
        row({
          id: "board_attention",
          title: "Attention",
          order: 2,
          columns: ["doc_view_a", "doc_view_b"],
          defaultOpen: true,
        }),
      ),
    ).toEqual({
      id: "board_attention",
      title: "Attention",
      order: 2,
      columnIds: ["doc_view_a", "doc_view_b"],
      kanban: null,
      defaultOpen: true,
      query: null,
    });
  });

  /** A kanban board's columns are its stages; `columns` is null on the file. */
  it("carries a kanban block and its scope", () => {
    const kanban = { field: "stage" as const, stages: ["candidates", "offer"] };
    const result = toBoard(row({ kanban, query: { tag: "housing" } }));
    expect(result.kanban).toEqual(kanban);
    expect(result.query).toEqual({ tag: "housing" });
    expect(result.columnIds).toEqual([]);
  });

  /** A file listing the same view twice keeps both entries — no dedupe (§10). */
  it("does not deduplicate a repeated column", () => {
    expect(toBoard(row({ columns: ["doc_v", "doc_v"] })).columnIds).toEqual(["doc_v", "doc_v"]);
  });
});

describe("compareBoards", () => {
  it("orders by `order`, with a board carrying none placed last", () => {
    const sorted = [board({ id: "b", order: null }), board({ id: "a", order: 3 })].sort(
      compareBoards,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  /** UI-148's first edge case: two boards at the same `order`. */
  it("breaks a tie by title, case-insensitively, then by id", () => {
    const sorted = [
      board({ id: "b3", title: "files", order: 1 }),
      board({ id: "b1", title: "Attention", order: 1 }),
      board({ id: "b2", title: "Attention", order: 1 }),
    ].sort(compareBoards);
    expect(sorted.map((entry) => entry.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("is a total order — sorting twice gives the same sequence", () => {
    const set = [
      board({ id: "z", title: "Z", order: null }),
      board({ id: "a", title: "A", order: null }),
      board({ id: "m", title: "M", order: 5 }),
    ];
    expect([...set].sort(compareBoards).map((entry) => entry.id)).toEqual(
      [...set]
        .reverse()
        .sort(compareBoards)
        .map((entry) => entry.id),
    );
  });
});

describe("resolveBoard", () => {
  const boards = [
    board({ id: "first", order: 1 }),
    board({ id: "flagged", order: 2, defaultOpen: true }),
  ];

  it("shows the board this browser chose", () => {
    expect(resolveBoard(boards, "first")?.id).toBe("first");
  });

  /** A browser that remembers nothing lands on `default-open` (rider 2 amended). */
  it("falls back to the default-open board", () => {
    expect(resolveBoard(boards, null)?.id).toBe("flagged");
  });

  /** A remembered board that was archived or deleted falls back the same way. */
  it("falls back when the remembered board is gone", () => {
    expect(resolveBoard(boards, "archived_one")?.id).toBe("flagged");
  });

  it("falls back to the first in order when no board carries the flag", () => {
    const plain = [board({ id: "first", order: 1 }), board({ id: "second", order: 2 })];
    expect(resolveBoard(plain, null)?.id).toBe("first");
    expect(resolveBoard(plain, "gone")?.id).toBe("first");
  });

  /** A workspace that never ran the migration has no board, and says so. */
  it("answers null when there are no boards", () => {
    expect(resolveBoard([], null)).toBeNull();
    expect(resolveBoard([], "anything")).toBeNull();
  });
});
