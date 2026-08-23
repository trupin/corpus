/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KanbanSpec } from "../board/boardDoc";
import { KanbanExplanation, KanbanGraph } from "./KanbanGraph";

afterEach(cleanup);

const FUNNEL: KanbanSpec = { field: "stage", stages: ["a", "b", "c"] };

const WRITTEN: KanbanSpec = {
  field: "stage",
  stages: ["candidates", "offer", "dropped"],
  transitions: { candidates: ["offer"], offer: [], dropped: ["candidates"] },
  status: { dropped: "archived" },
};

function edges(): { forward: number; back: number } {
  const svg = screen.getByRole("img");
  return {
    forward: svg.querySelectorAll("path.fwd").length,
    back: svg.querySelectorAll("path.back").length,
  };
}

describe("KanbanGraph", () => {
  it("draws one node per stage, named", () => {
    render(<KanbanGraph kanban={WRITTEN} />);
    expect(screen.getByRole("img").querySelectorAll("rect.node")).toHaveLength(3);
    for (const stage of WRITTEN.stages) expect(screen.getByText(stage)).toBeTruthy();
  });

  it("outlines exactly the stages the status map names", () => {
    render(<KanbanGraph kanban={WRITTEN} />);
    expect(screen.getByRole("img").querySelectorAll("rect.node.mapped")).toHaveLength(1);
  });

  it("arcs forward edges above and backward edges below, dashed", () => {
    render(<KanbanGraph kanban={WRITTEN} />);
    // candidates → offer is forward; dropped → candidates is backward.
    expect(edges()).toEqual({ forward: 1, back: 1 });
  });

  it("draws the funnel too — an absent `transitions` is a graph, not no graph", () => {
    render(<KanbanGraph kanban={FUNNEL} />);
    // a→b, b→c forward; b→a, c→b backward.
    expect(edges()).toEqual({ forward: 2, back: 2 });
  });

  it("draws nothing at all along an empty graph", () => {
    render(<KanbanGraph kanban={{ ...FUNNEL, transitions: {} }} />);
    expect(edges()).toEqual({ forward: 0, back: 0 });
  });

  it("renders nothing for a kanban with no stages", () => {
    const { container } = render(<KanbanGraph kanban={{ field: "stage", stages: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("KanbanExplanation", () => {
  it("says the drag follows the written transitions", () => {
    render(<KanbanExplanation kanban={WRITTEN} />);
    expect(
      screen.getByText(/A drag follows the transitions drawn above and nothing else/),
    ).toBeTruthy();
  });

  it("says the drag reaches a neighbour only when no transitions are written", () => {
    render(<KanbanExplanation kanban={FUNNEL} />);
    expect(
      screen.getByText(/No transitions are written, so a drag reaches the next or previous stage/),
    ).toBeTruthy();
  });

  it("names each mapped stage and what every other stage writes", () => {
    render(<KanbanExplanation kanban={WRITTEN} />);
    expect(screen.getByText("dropped")).toBeTruthy();
    expect(screen.getByText("archived")).toBeTruthy();
    expect(screen.getByText(/every other stage writes/)).toBeTruthy();
  });

  it("says nothing about a coupling a board does not declare", () => {
    render(<KanbanExplanation kanban={FUNNEL} />);
    expect(screen.queryByText(/its stage decides its status/)).toBeNull();
  });
});
