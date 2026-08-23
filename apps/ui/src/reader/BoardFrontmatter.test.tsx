/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { docFixture } from "../testing/readerFixture";
import { BoardFrontmatter } from "./BoardFrontmatter";

afterEach(cleanup);

/**
 * "The board document's reader shows its frontmatter and a one-line
 * explanation" (UI-148, `design/navigation.html`'s `fmBlock`).
 */

const frontmatter = (overrides: Record<string, unknown> = {}) =>
  docFixture({ frontmatter: { type: "board", title: "Attention", ...overrides } }).frontmatter;

describe("BoardFrontmatter", () => {
  it("draws nothing at all on a document that is not a board", () => {
    const { container } = render(<BoardFrontmatter frontmatter={frontmatter({ type: "note" })} />);
    expect(container.querySelector(".board-fm")).toBeNull();
  });

  it("lists the columns the file lists, in file order", () => {
    const { container } = render(
      <BoardFrontmatter
        frontmatter={frontmatter({ columns: ["doc_view_a", "doc_view_b"], order: 2 })}
      />,
    );
    const text = container.querySelector(".fm-block")?.textContent ?? "";
    expect(text).toContain("type: board");
    expect(text).toContain("order: 2");
    expect(text).toContain("- doc_view_a");
    expect(text).toContain("- doc_view_b");
    expect(container.textContent).toContain("A board is a document");
  });

  /** A file listing the same view twice renders both lines — §10 gives no dedupe. */
  it("lists a repeated column twice", () => {
    const { container } = render(
      <BoardFrontmatter frontmatter={frontmatter({ columns: ["doc_v", "doc_v"] })} />,
    );
    const lines = (container.querySelector(".fm-block")?.textContent ?? "").split("- doc_v");
    expect(lines).toHaveLength(3);
  });

  it("says an empty board is empty rather than saying nothing", () => {
    const { container } = render(<BoardFrontmatter frontmatter={frontmatter({ columns: [] })} />);
    expect(container.querySelector(".fm-block")?.textContent).toContain("columns: []");
  });

  it("marks the board that receives every open naming no board", () => {
    const { container } = render(
      <BoardFrontmatter frontmatter={frontmatter({ defaultOpen: true })} />,
    );
    // The **file's** spelling, not the wire's — that is what a person edits.
    expect(container.querySelector(".fm-block")?.textContent).toContain("default-open: true");
  });

  /** A kanban board has stages instead of columns (rider 6). */
  it("draws a kanban's field, stages, transitions and status map", () => {
    const { container } = render(
      <BoardFrontmatter
        frontmatter={frontmatter({
          columns: null,
          query: { tag: "housing" },
          kanban: {
            field: "stage",
            stages: ["candidates", "offer", "done"],
            transitions: { candidates: ["offer"], offer: ["done"], done: [] },
            status: { done: "resolved" },
          },
        })}
      />,
    );
    const text = container.querySelector(".fm-block")?.textContent ?? "";
    expect(text).toContain("field: stage");
    expect(text).toContain("stages: [candidates, offer, done]");
    expect(text).toContain("candidates: [offer]");
    expect(text).toContain("done: resolved");
    expect(text).toContain("tag: housing");
    // Its columns are derived, so there is no `columns` line to draw.
    expect(text).not.toContain("columns:");
  });
});
