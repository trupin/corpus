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

/** Two identical items with a different one between them — the ordinary case. */
const DUPES = todoBody([
  ["Call the plumber", false],
  ["Chase the invoice", false],
  ["Call the plumber", false],
]);

const target = (overrides: Partial<TodoItemTarget> = {}): TodoItemTarget => ({
  docId: "doc_week",
  listTitle: "Week of Jul 20",
  index: 1,
  item: { text: "Call the plumber", done: false },
  ...overrides,
});

/** The row for the plumber item at `index` of {@link DUPES}. */
const plumber = (index: number): TodoItemTarget =>
  target({ index, item: { text: "Call the plumber", done: false } });

/**
 * An anchor resolved **where it actually lands**: on the `nth` (0-based)
 * occurrence of `exact` in the body the menu is about to read.
 *
 * The range is the identity, not the quote (PR #19 MAJOR 3): a document with
 * two "Call the plumber" lines has two candidate spans, and the thread belongs
 * to exactly one of them.
 */
const anchorOn = (
  exact: string,
  overrides: Partial<ResolvedAnchor> = {},
  where: { readonly body?: string; readonly nth?: number } = {},
): ResolvedAnchor => {
  const body = where.body ?? BODY;
  let start = body.indexOf(exact);
  for (let seen = 0; seen < (where.nth ?? 0); seen += 1) start = body.indexOf(exact, start + 1);
  return {
    anchorId: "anc_1",
    threadId: "th_plumber",
    threadStatus: "open",
    selector: { exact, prefix: "", suffix: "" },
    range: { start, end: start + exact.length },
    orphaned: false,
    ...overrides,
  };
};

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

  /**
   * PR #19, MAJOR 3. Two rows read "Call the plumber"; one of them has a
   * thread. Offering it to the other is the menu inventing a relationship the
   * document does not have (SPEC.md §10 — "exactly that item's existing
   * actions, nothing invented"), and following it navigates to a conversation
   * about a different line.
   */
  it("does not lend the earlier duplicate's thread to a later namesake", async () => {
    mount({
      body: DUPES,
      anchors: [anchorOn("Call the plumber", {}, { body: DUPES, nth: 0 })],
      subject: plumber(2),
    });
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(acts()).toEqual(["toggle", "comment"]);
  });

  it("offers the later duplicate's own thread, and offers it only to that row", async () => {
    const onSecond = { body: DUPES, nth: 1 };
    mount({
      body: DUPES,
      anchors: [anchorOn("Call the plumber", {}, onSecond)],
      subject: plumber(2),
    });
    await waitFor(() => {
      expect(acts()).toEqual(["toggle", "comment", "open-thread"]);
    });
    cleanup();
    mount({
      body: DUPES,
      anchors: [anchorOn("Call the plumber", {}, onSecond)],
      subject: plumber(0),
    });
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(acts()).toEqual(["toggle", "comment"]);
  });

  /**
   * The same guard `itemSelector` has always had, now on this half too: between
   * the aggregate and the document read, the item at that index can be someone
   * else. An anchor on *that* item is not this row's thread.
   */
  it("offers no thread when the index no longer holds the item the row named", async () => {
    mount({
      anchors: [anchorOn("Send the signed form")],
      subject: target({ index: 2, item: { text: "Call the plumber", done: false } }),
    });
    await waitFor(() => {
      expect(act("comment").textContent).toContain("not in the document body");
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
