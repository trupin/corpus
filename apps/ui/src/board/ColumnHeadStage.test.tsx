/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import type { StageColumnActs } from "../menu/ColumnMenuItems";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { boardTransport } from "../testing/boardFixture";
import type { Board, KanbanSpec } from "./boardDoc";
import { ColumnHead } from "./ColumnHead";
import { deriveStageColumns } from "./kanban";
import type { BoardColumn } from "./viewDoc";

/**
 * A **stage** column's header (SPEC.md §10, rider 6): its kind label, its chips,
 * and the acts its `⋯` offers — which are the board document's, not a view's.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const HOUSING: KanbanSpec = {
  field: "stage",
  stages: ["candidates", "visiting", "done"],
  transitions: { candidates: ["visiting"], visiting: ["done", "candidates"], done: [] },
  status: { done: "resolved" },
};

const BOARD: Board = {
  id: "board_k",
  title: "House hunt",
  order: 1,
  columnIds: [],
  kanban: HOUSING,
  defaultOpen: false,
  query: { tag: "housing" },
  width: null,
};

const columns = deriveStageColumns(BOARD);
const at = (stage: string): BoardColumn =>
  columns.find((column) => column.title === stage) as BoardColumn;

function acts(column: BoardColumn, overrides: Partial<StageColumnActs> = {}): StageColumnActs {
  const stage = column.stage!;
  return {
    stage: stage.stage,
    field: stage.field,
    canMoveLeft: stage.index > 0,
    canMoveRight: stage.index < stage.lastIndex,
    onEditStages: vi.fn(),
    onEditTransitions: vi.fn(),
    onMove: vi.fn(),
    onOpenBoard: vi.fn(),
    ...overrides,
  };
}

function renderHead(column: BoardColumn, stageActs: StageColumnActs, canAdd = false) {
  const harness = createCorpusTestHarness({ fetch: boardTransport().fetch });
  const props = {
    column,
    count: 3,
    stageActs,
    canAdd,
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onEditQuery: vi.fn(),
    onRemove: vi.fn(),
    onHandle: vi.fn(),
  };
  return {
    props,
    ...render(
      <harness.Wrapper>
        <ContextMenuProvider>
          <ColumnHead {...props} />
        </ContextMenuProvider>
      </harness.Wrapper>,
    ),
  };
}

describe("a stage column's header", () => {
  it("says STAGE as its kind, and the stage as its title", () => {
    const { container } = renderHead(at("visiting"), acts(at("visiting")));
    expect(container.querySelector(".col-title")?.textContent).toBe("visiting");
    expect(container.querySelector(".col-kind")?.textContent).toBe("stage");
  });

  it("draws the scope, the field, the sentinel note and the outgoing edges", () => {
    const { container } = renderHead(at("candidates"), acts(at("candidates")));
    const chips = [...container.querySelectorAll(".chips > .chip")].map((node) => node.textContent);
    expect(chips).toEqual(["tag: housing", "stage: candidates", "or no stage", "→ visiting"]);
    expect(container.querySelector(".chips > .chip.edge")?.textContent).toBe("→ visiting");
  });

  it("draws the status a mapped stage writes, and `→ ∅` when nothing leads out", () => {
    const { container } = renderHead(at("done"), acts(at("done")));
    const chips = [...container.querySelectorAll(".chips > .chip")].map((node) => node.textContent);
    expect(chips).toEqual(["tag: housing", "stage: done", "→ resolved", "→ ∅"]);
    expect(container.querySelector(".chip.good")?.textContent).toBe("→ resolved");
    expect(container.querySelector(".chip.edge.end")?.textContent).toBe("→ ∅");
  });

  it("offers `＋` on the first column only — a new document lands there", () => {
    const first = renderHead(at("candidates"), acts(at("candidates")), true);
    expect(first.container.querySelector(".col-add")).not.toBeNull();
    cleanup();
    const later = renderHead(at("visiting"), acts(at("visiting")), false);
    expect(later.container.querySelector(".col-add")).toBeNull();
  });

  it("offers the board document's acts and NOT the view document's", () => {
    renderHead(at("visiting"), acts(at("visiting")));
    fireEvent.click(screen.getByRole("button", { name: "List options for visiting" }));

    expect(screen.getByRole("menuitem", { name: /Edit the stages/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Edit the transitions/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Move left/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Move right/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Open the board document/ })).toBeTruthy();
    // A stage is not a column somebody added to a board, so it cannot be removed
    // from one — and it has no view document to rename or re-query.
    expect(screen.queryByRole("menuitem", { name: /Remove from this board/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Edit query/ })).toBeNull();
  });

  it("disables the move that would run off the end of `kanban.stages`", () => {
    renderHead(at("candidates"), acts(at("candidates")));
    fireEvent.click(screen.getByRole("button", { name: "List options for candidates" }));
    expect(screen.getByRole("menuitem", { name: /Move left/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: /Move right/ })).toHaveProperty("disabled", false);
  });

  it("runs the act the menu names", () => {
    const stageActs = acts(at("visiting"));
    renderHead(at("visiting"), stageActs);
    fireEvent.click(screen.getByRole("button", { name: "List options for visiting" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit the transitions/ }));
    expect(stageActs.onEditTransitions).toHaveBeenCalled();
  });
});
