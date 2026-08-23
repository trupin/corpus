import { describe, expect, it } from "vitest";
import type { Board, KanbanSpec } from "./boardDoc";
import {
  canMove,
  deriveStageColumns,
  edgesToText,
  leadsTo,
  moveStage,
  refusalMessage,
  scopeToText,
  stageColumnId,
  textToEdges,
  textToScope,
  textToStages,
} from "./kanban";

const FUNNEL: KanbanSpec = { field: "stage", stages: ["a", "b", "c"] };

const HOUSING: KanbanSpec = {
  field: "stage",
  stages: ["candidates", "visiting", "offer", "done", "dropped"],
  transitions: {
    candidates: ["visiting", "dropped"],
    visiting: ["offer", "dropped"],
    offer: ["done", "visiting", "dropped"],
    done: [],
    dropped: ["candidates"],
  },
  status: { done: "resolved", dropped: "archived" },
};

const board = (overrides: Partial<Board> = {}): Board => ({
  id: "board_k",
  title: "House hunt",
  order: 1,
  columnIds: [],
  kanban: HOUSING,
  defaultOpen: false,
  query: { tag: "housing" },
  width: null,
  ...overrides,
});

describe("leadsTo", () => {
  it("is the linear funnel when `transitions` is absent — both ways", () => {
    expect(leadsTo(FUNNEL, "a")).toEqual(["b"]);
    expect(leadsTo(FUNNEL, "b")).toEqual(["c", "a"]);
    expect(leadsTo(FUNNEL, "c")).toEqual(["b"]);
  });

  it("is empty when `transitions` is `{}` — absent is not empty (AGENT-042)", () => {
    const nothing: KanbanSpec = { ...FUNNEL, transitions: {} };
    expect(leadsTo(nothing, "a")).toEqual([]);
    expect(leadsTo(nothing, "b")).toEqual([]);
    // …and that is exactly the difference the seed kanban depends on.
    expect(leadsTo(FUNNEL, "a")).not.toEqual(leadsTo(nothing, "a"));
  });

  it("is exactly what is written when `transitions` is written", () => {
    expect(leadsTo(HOUSING, "offer")).toEqual(["done", "visiting", "dropped"]);
    expect(leadsTo(HOUSING, "done")).toEqual([]);
    expect(leadsTo(HOUSING, "dropped")).toEqual(["candidates"]);
  });

  it("drops a target the board does not declare, and a self-edge", () => {
    const odd: KanbanSpec = { field: "stage", stages: ["a", "b"], transitions: { a: ["a", "z"] } };
    expect(leadsTo(odd, "a")).toEqual([]);
  });

  it("answers nothing for a stage the board does not draw", () => {
    expect(leadsTo(FUNNEL, "elsewhere")).toEqual([]);
  });
});

describe("canMove", () => {
  it("refuses a skip on the funnel and allows both neighbours", () => {
    expect(canMove(FUNNEL, "a", "b")).toBe(true);
    expect(canMove(FUNNEL, "b", "a")).toBe(true);
    expect(canMove(FUNNEL, "a", "c")).toBe(false);
  });

  it("refuses a drop on the column the row is already in", () => {
    expect(canMove(FUNNEL, "b", "b")).toBe(false);
  });

  it("follows the written graph, including its dead end", () => {
    expect(canMove(HOUSING, "candidates", "visiting")).toBe(true);
    expect(canMove(HOUSING, "candidates", "offer")).toBe(false);
    expect(canMove(HOUSING, "done", "dropped")).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("names both stages and the other route", () => {
    expect(refusalMessage(HOUSING, "candidates", "offer")).toBe(
      "“candidates” does not lead to “offer” on this board. " +
        "Set stage in the document to override, or add the transition to the board.",
    );
  });
});

describe("edgesToText / textToEdges", () => {
  it("is blank for a board carrying no transitions — blank is the funnel", () => {
    expect(edgesToText(FUNNEL)).toBe("");
  });

  it("round-trips a written graph", () => {
    const text = edgesToText(HOUSING);
    expect(text).toBe(
      "candidates > visiting, dropped; visiting > offer, dropped; " +
        "offer > done, visiting, dropped; done > ; dropped > candidates",
    );
    expect(textToEdges(text, HOUSING.stages)).toEqual(HOUSING.transitions);
  });

  it("gives every declared stage a key, so an unmentioned stage leads nowhere", () => {
    expect(textToEdges("a > b", ["a", "b", "c"])).toEqual({ a: ["b"], b: [], c: [] });
  });

  it("drops a stage the board does not declare, on either side", () => {
    expect(textToEdges("a > z; q > b", ["a", "b"])).toEqual({ a: [], b: [] });
  });
});

describe("textToStages", () => {
  it("trims, and drops blanks and repeats", () => {
    expect(textToStages(" a , b ,, a , c ")).toEqual(["a", "b", "c"]);
    expect(textToStages("   ")).toEqual([]);
  });
});

describe("textToScope / scopeToText", () => {
  it("takes the three keys the form offers, and nothing else", () => {
    expect(textToScope("tag: housing")).toEqual({ tag: "housing" });
    expect(textToScope("folder:finance/housing")).toEqual({ folder: "finance/housing" });
    expect(textToScope("type: note")).toEqual({ type: "note" });
  });

  it("is everything for a blank or unrecognised line", () => {
    expect(textToScope("")).toEqual({});
    expect(textToScope("needs=me")).toEqual({});
  });

  it("renders a scope back into the line", () => {
    expect(scopeToText({ tag: "housing" })).toBe("tag:housing");
    expect(scopeToText(null)).toBe("");
  });
});

describe("moveStage", () => {
  it("moves one stage and leaves the rest in order", () => {
    expect(moveStage(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveStage(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("returns the same array at either end", () => {
    const stages = ["a", "b"];
    expect(moveStage(stages, 0, -1)).toBe(stages);
    expect(moveStage(stages, 1, 2)).toBe(stages);
    expect(moveStage(stages, 1, 1)).toBe(stages);
  });
});

describe("deriveStageColumns", () => {
  it("is one column per stage, in `stages` order, with stable ids", () => {
    const columns = deriveStageColumns(board());
    expect(columns.map((column) => column.title)).toEqual(HOUSING.stages);
    expect(columns.map((column) => column.id)).toEqual(
      HOUSING.stages.map((stage) => stageColumnId("board_k", stage)),
    );
    expect(stageColumnId("board_k", "offer")).toBe("board_k#offer");
  });

  it("names the board document as `viewId` — every act on a stage edits the board", () => {
    expect(deriveStageColumns(board())[0]?.viewId).toBe("board_k");
    expect(deriveStageColumns(board())[0]?.kind).toBe("stage");
  });

  it("asks for the first stage and the unstaged in ONE request (`stage=,<first>`)", () => {
    const columns = deriveStageColumns(board());
    expect(columns[0]?.filter).toEqual({ tag: "housing", stage: ",candidates" });
    expect(columns[1]?.filter).toEqual({ tag: "housing", stage: "visiting" });
    expect(columns[0]?.stage?.holdsUnset).toBe(true);
    expect(columns[1]?.stage?.holdsUnset).toBe(false);
  });

  it("adds `status=archived` to a stage the board maps to archived", () => {
    const columns = deriveStageColumns(board());
    expect(columns[4]?.filter).toEqual({ tag: "housing", stage: "dropped", status: "archived" });
    expect(columns[3]?.filter).toEqual({ tag: "housing", stage: "done" });
  });

  it("leaves the board's own `status` filter alone — the scope wins", () => {
    const columns = deriveStageColumns(board({ query: { tag: "housing", status: "open" } }));
    expect(columns[4]?.filter["status"]).toBe("open");
  });

  it("has no null sentinel on a kanban over `status` — every document has one", () => {
    const columns = deriveStageColumns(
      board({
        kanban: { field: "status", stages: ["open", "resolved", "archived"] },
        query: { type: "note" },
      }),
    );
    expect(columns[0]?.filter).toEqual({ type: "note", status: "open" });
    expect(columns[0]?.stage?.holdsUnset).toBe(false);
    expect(columns[2]?.filter).toEqual({ type: "note", status: "archived" });
  });

  it("draws the scope chips, the field chip, the sentinel note, the map and the edges", () => {
    const first = deriveStageColumns(board())[0];
    expect(first?.chips.map((chip) => chip.label)).toEqual([
      "tag: housing",
      "stage: candidates",
      "or no stage",
      "→ open",
      "→ visiting",
      "→ dropped",
    ]);
    const dropped = deriveStageColumns(board())[4];
    expect(dropped?.chips.map((chip) => chip.label)).toEqual([
      "tag: housing",
      "stage: dropped",
      "→ archived",
      "→ candidates",
    ]);
    expect(dropped?.chips.find((chip) => chip.label === "→ archived")?.tone).toBe("good");
  });

  /**
   * §5's two outcomes, both drawn: a stage the map names writes that status, and
   * a stage it does not names none — so entering it writes `open`. The unmapped
   * column is the one drop that can reopen resolved work, and it used to be the
   * only column whose head said nothing about what a drop would do (PR #58
   * review).
   */
  it("says `→ open` on a stage the map does not name, muted rather than good", () => {
    const offer = deriveStageColumns(board())[2];
    const chip = offer?.chips.find((entry) => entry.key === "unmapped");
    expect(chip?.label).toBe("→ open");
    expect(chip?.tone).toBe("muted");
    expect(chip?.title).toContain("maps no status to this stage");
    // One status chip per column, never two.
    expect(offer?.chips.filter((entry) => entry.label.startsWith("→ open"))).toHaveLength(1);
    const done = deriveStageColumns(board())[3];
    expect(done?.chips.find((entry) => entry.key === "unmapped")).toBeUndefined();
  });

  /**
   * A kanban over `status` moves the field itself, so §5's coupling never runs
   * on it — the server skips those boards outright. A `→ open` on its `resolved`
   * column would be a promise nothing keeps.
   */
  it("draws no default-status chip on a kanban over `status`", () => {
    const columns = deriveStageColumns(
      board({
        kanban: { field: "status", stages: ["open", "resolved", "archived"] },
        query: { type: "note" },
      }),
    );
    expect(
      columns.flatMap((column) => column.chips).filter((chip) => chip.key === "unmapped"),
    ).toEqual([]);
  });

  it("says `→ ∅` for a stage nothing leads out of", () => {
    const done = deriveStageColumns(board())[3];
    expect(done?.chips.at(-1)).toMatchObject({ label: "→ ∅", tone: "edge-end" });
  });

  it("carries where each column leads and where it sits", () => {
    const columns = deriveStageColumns(board());
    expect(columns[2]?.stage).toMatchObject({
      boardId: "board_k",
      field: "stage",
      stage: "offer",
      index: 2,
      lastIndex: 4,
      mapped: null,
      leadsTo: ["done", "visiting", "dropped"],
    });
    expect(columns[3]?.stage?.mapped).toBe("resolved");
  });

  it("gives every stage column the board document's width", () => {
    expect(deriveStageColumns(board({ width: 420 }))[0]?.width).toBe(420);
  });

  it("is empty for a board that is not a kanban", () => {
    expect(deriveStageColumns(board({ kanban: null }))).toEqual([]);
  });
});
