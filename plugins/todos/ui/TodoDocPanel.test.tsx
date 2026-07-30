/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodoDocPanel } from "./TodoDocPanel.js";
import { todoBody, todoDoc } from "./testing.js";

afterEach(cleanup);

/** `[text, done, due?]`, rendered into body task-list lines. */
type Line = readonly [string, boolean, string?];

/** The day every dated fixture below is read against. */
const TODAY = new Date("2026-07-20T12:00:00.000Z");

/** The panel takes no props but the document — it has no data path of its own. */
function panelFor(items: readonly Line[]): void {
  render(<TodoDocPanel doc={todoDoc("doc_week", {}, todoBody(items))} now={TODAY} />);
}

const stat = (which: "open" | "done"): string | null =>
  document.querySelector(`[data-stat-${which}]`)?.textContent ?? null;

describe("TodoDocPanel", () => {
  it("derives open and done counts from the document body", () => {
    panelFor([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
    expect(stat("open")).toBe("2");
    expect(stat("done")).toBe("1");
  });

  it.each([
    [[] as readonly Line[], "0", "0", 0],
    [
      [
        ["a", false],
        ["b", false],
      ] as readonly Line[],
      "2",
      "0",
      0,
    ],
    [
      [
        ["a", true],
        ["b", true],
      ] as readonly Line[],
      "0",
      "2",
      100,
    ],
  ])("reports %#: %s open, %s done, %i%% complete", (items, open, done, complete) => {
    panelFor(items);
    expect(stat("open")).toBe(open);
    expect(stat("done")).toBe(done);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(complete));
  });

  it("treats a body with no task lines as an empty list", () => {
    render(<TodoDocPanel doc={todoDoc("doc_new", {})} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("0");
  });

  it("still counts a not-yet-migrated document's frontmatter items", () => {
    render(
      <TodoDocPanel
        doc={todoDoc("doc_legacy", {
          items: [
            { text: "a", done: false, ts: "2026-07-20T09:00:00.000Z" },
            { text: "b", done: true, ts: "2026-07-20T09:00:00.000Z" },
          ],
        })}
      />,
    );
    expect(stat("open")).toBe("1");
    expect(stat("done")).toBe("1");
  });

  it("shows a due chip only when open items carry deadlines", () => {
    // Only the open one counts: a completed item's deadline is history.
    panelFor([
      ["a", false, "2026-08-01"],
      ["b", true, "2026-08-02"],
    ]);
    expect(screen.getByText("1 due")).toBeTruthy();
    cleanup();
    panelFor([["a", false]]);
    expect(screen.queryByText(/due/)).toBeNull();
  });

  /**
   * SPEC.md §12: the overdue treatment applies wherever items are shown, and
   * this was the one surface showing a deadline count without it — a list with
   * a deadline three weeks gone read exactly like one due next month, on the
   * very screen the user opened to work on it.
   */
  describe("the overdue treatment", () => {
    const chip = (): HTMLElement | null => document.querySelector("[data-todo-overdue]");

    it("marks the chip and says how many, when an open deadline has passed", () => {
      panelFor([
        ["a", false, "2026-07-10"],
        ["b", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("2 due · 1 overdue");
      expect(chip()?.className).toContain("overdue");
    });

    it("leaves the chip plain when every deadline is still ahead", () => {
      panelFor([["a", false, "2026-08-01"]]);
      expect(chip()?.textContent).toBe("1 due");
      expect(chip()?.className).not.toContain("overdue");
      expect(chip()?.getAttribute("data-todo-overdue")).toBe("0");
    });

    it("never calls a completed item overdue, however long ago it was due", () => {
      panelFor([
        ["a", true, "2026-01-01"],
        ["b", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("1 due");
      expect(chip()?.className).not.toContain("overdue");
    });

    it("counts every passed deadline, not just the first", () => {
      panelFor([
        ["a", false, "2026-07-01"],
        ["b", false, "2026-07-10"],
        ["c", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("3 due · 2 overdue");
    });
  });

  it("names the plugin, as the design's panel does", () => {
    panelFor([]);
    expect(screen.getByText("plugin: todos")).toBeTruthy();
  });

  /**
   * A malformed legacy key is the one thing left that can be unreadable, and it
   * is a hand-edit the user has to fix: a stats panel over it would be a
   * quieter second claim about a broken state nothing else on screen explains.
   */
  it("renders nothing at all for a document whose legacy items are malformed", () => {
    const { container } = render(<TodoDocPanel doc={todoDoc("doc_bad", { items: "nope" })} />);
    expect(container.firstChild).toBeNull();
  });

  it("recomputes when the body changes, holding no state of its own", () => {
    const { rerender } = render(
      <TodoDocPanel doc={todoDoc("doc_week", {}, todoBody([["a", false]]))} />,
    );
    expect(stat("open")).toBe("1");
    rerender(<TodoDocPanel doc={todoDoc("doc_week", {}, todoBody([["a", true]]))} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("1");
  });
});
