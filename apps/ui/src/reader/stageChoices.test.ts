import type { DocFrontmatter } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import type { Board } from "../board/boardDoc";
import { offeredStages, stageChoicesFor, type ScopedDoc } from "./stageChoices";

const board = (overrides: Partial<Board>): Board => ({
  id: "board_a",
  title: "House hunt",
  order: 1,
  columnIds: [],
  kanban: { field: "stage", stages: ["candidates", "offer"] },
  defaultOpen: false,
  query: null,
  width: null,
  ...overrides,
});

const doc = (overrides: Partial<DocFrontmatter> = {}, folder = "finance/housing"): ScopedDoc => ({
  frontmatter: { ...docRowFixture({ type: "note", tags: ["housing"] }), anchors: {}, ...overrides },
  folder,
});

describe("stageChoicesFor", () => {
  it("offers a board whose scope holds the document, under its own name", () => {
    const groups = stageChoicesFor([board({ query: { tag: "housing" } })], doc());
    expect(groups).toEqual([
      { boardId: "board_a", boardTitle: "House hunt", stages: ["candidates", "offer"] },
    ]);
  });

  it("offers nothing from a board whose scope excludes the document", () => {
    expect(stageChoicesFor([board({ query: { tag: "tax" } })], doc())).toEqual([]);
    expect(stageChoicesFor([board({ query: { type: "thread" } })], doc())).toEqual([]);
    expect(stageChoicesFor([board({ query: { folder: "inbox" } })], doc())).toEqual([]);
  });

  it("matches a folder by prefix, as `GET /api/docs?folder=` does", () => {
    expect(stageChoicesFor([board({ query: { folder: "finance" } })], doc())).toHaveLength(1);
    expect(stageChoicesFor([board({ query: { folder: "finance/housing/" } })], doc())).toHaveLength(
      1,
    );
    expect(stageChoicesFor([board({ query: { folder: "financial" } })], doc())).toHaveLength(0);
  });

  it("treats a filter it cannot evaluate as matching, never as an exclusion", () => {
    // `needs` is the projection's, not this client's — hiding a whole board's
    // vocabulary on the strength of a filter we did not run is the failure this
    // rule exists to prevent.
    expect(stageChoicesFor([board({ query: { needs: "me" } })], doc())).toHaveLength(1);
  });

  it("ignores a kanban over `status` — the status control already offers those", () => {
    const statuses = board({
      kanban: { field: "status", stages: ["open", "resolved", "archived"] },
    });
    expect(stageChoicesFor([statuses], doc())).toEqual([]);
  });

  it("ignores a board that is not a kanban at all", () => {
    expect(stageChoicesFor([board({ kanban: null })], doc())).toEqual([]);
  });

  it("keeps two boards apart, because one `stage` value takes two vocabularies", () => {
    const groups = stageChoicesFor(
      [
        board({ id: "b1", title: "House hunt", query: { tag: "housing" } }),
        board({
          id: "b2",
          title: "Tax season",
          query: null,
          kanban: { field: "stage", stages: ["gather", "filed"] },
        }),
      ],
      doc(),
    );
    expect(groups.map((group) => group.boardTitle)).toEqual(["House hunt", "Tax season"]);
  });
});

describe("offeredStages", () => {
  it("deduplicates across boards", () => {
    const groups = [
      { boardId: "a", boardTitle: "A", stages: ["x", "y"] },
      { boardId: "b", boardTitle: "B", stages: ["y", "z"] },
    ];
    expect(offeredStages(groups, null)).toEqual(["x", "y", "z"]);
  });

  it("keeps a stage the document carries that no board draws", () => {
    expect(offeredStages([], "orphan")).toEqual(["orphan"]);
  });

  it("is empty for a document with no stage and no board claiming it", () => {
    expect(offeredStages([], null)).toEqual([]);
    expect(offeredStages([], "")).toEqual([]);
  });
});
