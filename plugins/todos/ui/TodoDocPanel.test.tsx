/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodoDocPanel } from "./TodoDocPanel.js";
import { TS, todoDoc } from "./testing.js";

afterEach(cleanup);

const item = (text: string, done: boolean, due?: string): Record<string, unknown> => ({
  text,
  done,
  ts: TS,
  ...(due === undefined ? {} : { due }),
});

/** The panel takes no props but the document — it has no data path of its own. */
function panelFor(items: unknown): void {
  render(<TodoDocPanel doc={todoDoc("doc_week", { items })} />);
}

const stat = (which: "open" | "done"): string | null =>
  document.querySelector(`[data-stat-${which}]`)?.textContent ?? null;

describe("TodoDocPanel", () => {
  it("derives open and done counts for a mixed list", () => {
    panelFor([item("a", false), item("b", true), item("c", false)]);
    expect(stat("open")).toBe("2");
    expect(stat("done")).toBe("1");
  });

  it.each([
    [[], "0", "0", 0],
    [[item("a", false), item("b", false)], "2", "0", 0],
    [[item("a", true), item("b", true)], "0", "2", 100],
  ])("reports %#: %s open, %s done, %i%% complete", (items, open, done, complete) => {
    panelFor(items);
    expect(stat("open")).toBe(open);
    expect(stat("done")).toBe(done);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(complete));
  });

  it("treats an absent `items` key as an empty list", () => {
    render(<TodoDocPanel doc={todoDoc("doc_new", {})} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("0");
  });

  it("shows a due chip only when open items carry deadlines", () => {
    // Only the open one counts: a completed item's deadline is history.
    panelFor([item("a", false, "2026-08-01"), item("b", true, "2026-08-02")]);
    expect(screen.getByText("1 due")).toBeTruthy();
    cleanup();
    panelFor([item("a", false)]);
    expect(screen.queryByText(/due/)).toBeNull();
  });

  it("names the plugin, as the design's panel does", () => {
    panelFor([]);
    expect(screen.getByText("plugin: todos")).toBeTruthy();
  });

  /**
   * The `View` is already showing why the list cannot be read; a stats panel
   * over the same broken state would be a second, quieter claim about it.
   */
  it("renders nothing at all for a document whose items are malformed", () => {
    const { container } = render(<TodoDocPanel doc={todoDoc("doc_bad", { items: "nope" })} />);
    expect(container.firstChild).toBeNull();
  });

  it("recomputes when the items change, holding no state of its own", () => {
    const { rerender } = render(
      <TodoDocPanel doc={todoDoc("doc_week", { items: [item("a", false)] })} />,
    );
    expect(stat("open")).toBe("1");
    rerender(<TodoDocPanel doc={todoDoc("doc_week", { items: [item("a", true)] })} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("1");
  });
});
