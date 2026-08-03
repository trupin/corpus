/** @vitest-environment jsdom */
import type { Doc, ResolvedAnchor } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todoBody, todoDoc, transport, wrapperFor } from "./testing.js";
import { TodoItemMenu, type TodoItemTarget } from "./TodoItemMenu.js";

afterEach(cleanup);

/**
 * The three quick actions a todo item has, and the one that is conditional
 * (PLUGINS-009 / sprint-023 TEST-1066–1067, TEST-1070–1071).
 *
 * The menu is judged on what it offers and on the payloads it hands back — the
 * writes themselves belong to the column, which outlives the menu.
 */

const BODY = todoBody([
  ["Book the passport appointment", false, "2026-08-01"],
  ["Call the plumber", false],
  ["Send the signed form", true],
]);

const target = (overrides: Partial<TodoItemTarget> = {}): TodoItemTarget => ({
  docId: "doc_week",
  listTitle: "Week of Jul 20",
  index: 1,
  item: { text: "Call the plumber", done: false },
  ...overrides,
});

const anchorOn = (exact: string, overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor => ({
  anchorId: "anc_1",
  threadId: "th_plumber",
  threadStatus: "open",
  selector: { exact, prefix: "", suffix: "" },
  range: { start: 0, end: exact.length },
  orphaned: false,
  ...overrides,
});

interface Mounted {
  readonly onToggle: ReturnType<typeof vi.fn>;
  readonly onComment: ReturnType<typeof vi.fn>;
  readonly onOpenThread: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
}

function mount(options: {
  readonly subject?: TodoItemTarget;
  readonly body?: string;
  readonly anchors?: readonly ResolvedAnchor[];
}): Mounted {
  const base = todoDoc("doc_week", {}, options.body ?? BODY);
  const doc: Doc = { ...base, anchors: [...(options.anchors ?? [])] };
  const wire = transport({ doc, lists: [] });
  const handlers = {
    onToggle: vi.fn(),
    onComment: vi.fn(),
    onOpenThread: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <TodoItemMenu target={options.subject ?? target()} clientX={20} clientY={30} {...handlers} />,
    { wrapper: wrapperFor(wire).Wrapper },
  );
  return handlers;
}

const acts = (): string[] =>
  screen.getAllByRole("menuitem").map((node) => node.dataset["act"] ?? "");

const act = (id: string): HTMLElement =>
  screen.getAllByRole("menuitem").find((node) => node.dataset["act"] === id) as HTMLElement;

describe("TodoItemMenu", () => {
  it("offers two actions for an item with no thread, and never a disabled third", async () => {
    mount({});
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(acts()).toEqual(["toggle", "comment"]);
    expect(screen.queryByText("Open existing thread")).toBeNull();
  });

  it("offers the third only when the item's own words already carry a thread", async () => {
    const onOpenThread = mount({ anchors: [anchorOn("Call the plumber")] }).onOpenThread;
    await waitFor(() => {
      expect(acts()).toEqual(["toggle", "comment", "open-thread"]);
    });
    fireEvent.click(act("open-thread"));
    expect(onOpenThread.mock.calls[0]?.[1]).toBe("th_plumber");
  });

  it("does not offer a thread anchored to a different item, or an orphaned one", async () => {
    mount({ anchors: [anchorOn("Send the signed form")] });
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(acts()).toEqual(["toggle", "comment"]);
    cleanup();
    mount({ anchors: [anchorOn("Call the plumber", { orphaned: true, range: null })] });
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(acts()).toEqual(["toggle", "comment"]);
  });

  it("names the toggle after what it will do, in both directions", async () => {
    mount({});
    expect(act("toggle").textContent).toContain("Mark as done");
    cleanup();
    mount({
      subject: target({ index: 2, item: { text: "Send the signed form", done: true } }),
    });
    await waitFor(() => {
      expect(act("toggle").textContent).toContain("Mark as open");
    });
  });

  it("hands the toggle back the row's own index and label, for the route's guard", () => {
    const { onToggle } = mount({});
    fireEvent.click(act("toggle"));
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc_week",
        index: 1,
        item: { text: "Call the plumber", done: false },
      }),
    );
  });

  it("waits for the document before it will let anyone comment", async () => {
    const { onComment } = mount({});
    // The selector is a slice of the body, and the body is one read away.
    expect(act("comment").hasAttribute("disabled")).toBe(true);
    expect(act("comment").textContent).toContain("reading the document…");
    fireEvent.click(act("comment"));
    expect(onComment).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
  });

  it("hands the composer a §6 selector framed by the document's real text", async () => {
    const { onComment } = mount({});
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(act("comment"));
    const selector = onComment.mock.calls[0]?.[1] as {
      exact: string;
      prefix: string;
      suffix: string;
    };
    expect(selector.exact).toBe("Call the plumber");
    expect(selector.prefix).toContain("- [ ] ");
    expect(selector.suffix).toContain("Send the signed form");
  });

  /**
   * A document whose items are still in the legacy frontmatter key has no task
   * lines to quote. Refusing with a reason beats anchoring a comment to text
   * that is not there (sprint-023 OC4, PLUGINS-008's storage states).
   */
  it("refuses to comment, with a reason, when the item is not in the body", async () => {
    mount({ body: "## Notes\n\nNothing here is a task line.\n" });
    await waitFor(() => {
      expect(act("comment").textContent).toContain("not in the document body");
    });
    expect(act("comment").hasAttribute("disabled")).toBe(true);
  });
});
