/** @vitest-environment jsdom */
import type { DocRow, Lock } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodoListItem } from "./TodoListItem.js";
import { listPayload, transport, wrapperFor } from "./testing.js";

afterEach(cleanup);

const NOW = new Date("2026-07-20T12:00:00.000Z");

type Item = { readonly text: string; readonly done: boolean; readonly due?: string };

const item = (text: string, done: boolean, due?: string): Item => ({
  text,
  done,
  ...(due === undefined ? {} : { due }),
});

const DEFAULT_ITEMS: readonly Item[] = [
  item("Renew passport", false),
  item("Send lease notice", true),
];

/**
 * A todo document's **row**. Since PLUGINS-005 it carries no items at all —
 * items are body text, and bodies do not ride list rows — so every fixture here
 * pairs the row with the aggregate entry the plugin's own route answers with,
 * which is exactly the pair production has.
 */
const todoRow = (overrides: Partial<DocRow> = {}): DocRow =>
  docRowFixture({
    id: "doc_week",
    type: "todo",
    title: "Week of Jul 20",
    path: "data/docs/todos/week.md",
    updated: "2026-07-19T09:00:00.000Z",
    excerpt: "a todo document",
    ...overrides,
  });

interface MountOptions {
  readonly items?: readonly Item[];
  readonly lists?: readonly Record<string, unknown>[] | null;
  readonly onOpen?: (row: DocRow) => void;
  readonly locks?: readonly Lock[];
}

function mountRow(row: DocRow, options: MountOptions = {}): ReturnType<typeof transport> {
  const wire = transport({
    docs: [row],
    locks: options.locks ?? [],
    lists: options.lists ?? [listPayload(row.id, row.title, options.items ?? DEFAULT_ITEMS)],
  });
  render(<TodoListItem row={row} now={NOW} onOpen={options.onOpen} />, {
    wrapper: wrapperFor(wire).Wrapper,
  });
  return wire;
}

const previews = (): string[] =>
  [...document.querySelectorAll(".todo-items .todo-item-text")].map(
    (node) => node.textContent ?? "",
  );

describe("TodoListItem", () => {
  it("renders a row with the document's title and type glyph", () => {
    mountRow(todoRow());
    expect(screen.getByText("Week of Jul 20")).toBeTruthy();
    expect(document.querySelector("[data-row-doc='doc_week']")).toBeTruthy();
    expect(document.querySelector(".type-glyph")?.textContent).toBe("todo");
  });

  it("previews the first three items with their checkboxes", async () => {
    mountRow(todoRow(), {
      items: [item("one", false), item("two", true), item("three", false), item("four", false)],
    });
    await waitFor(() => {
      expect(previews()).toEqual(["one", "two", "three"]);
    });
    expect([...document.querySelectorAll(".todo-items .box")].map((n) => n.textContent)).toEqual([
      "☐",
      "☑",
      "☐",
    ]);
    // The rest are counted, never listed: a row is a preview, not the list.
    expect(screen.getByText("+1 more")).toBeTruthy();
  });

  /**
   * TEST-512, from the row's side: ten todo rows on a board are one request,
   * because every row reads the same shared aggregate key.
   */
  it("issues one aggregate request, shared with every other todo row", async () => {
    const wire = mountRow(todoRow(), { items: [item("one", false)] });
    await waitFor(() => {
      expect(previews()).toEqual(["one"]);
    });
    expect(wire.pluginCalls()).toHaveLength(1);
    expect(new URL(wire.pluginCalls()[0]?.url ?? "http://x/").pathname).toMatch(
      /^\/api\/x\/todos\/lists\/at\/[a-z0-9]+$/,
    );
  });

  it("shows no preview and no more-affordance for an empty list", async () => {
    mountRow(todoRow(), { items: [] });
    await waitFor(() => {
      expect(document.querySelector(".row")).toBeTruthy();
    });
    expect(previews()).toEqual([]);
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("degrades to no preview rather than crashing when the aggregate cannot be read", async () => {
    expect(() => {
      mountRow(todoRow(), { lists: null });
    }).not.toThrow();
    await waitFor(() => {
      expect(document.querySelector(".row")).toBeTruthy();
    });
    expect(previews()).toEqual([]);
  });

  it("badges the number of open items carrying a deadline", async () => {
    mountRow(todoRow(), {
      items: [item("a", false, "2026-08-01"), item("b", false), item("c", true, "2026-08-02")],
    });
    await waitFor(() => {
      expect(screen.getByText("1 due")).toBeTruthy();
    });
  });

  it("shows no due badge when nothing open has a deadline", async () => {
    mountRow(todoRow());
    await waitFor(() => {
      expect(previews()).toHaveLength(2);
    });
    expect(screen.queryByText(/due/)).toBeNull();
  });

  it("applies the overdue treatment to a past deadline", async () => {
    mountRow(todoRow(), { items: [item("late", false, "2026-07-10")] });
    await waitFor(() => {
      expect(document.querySelector(".todo-items .t")?.className).toContain("overdue");
    });
  });

  it("opens the document on click and on Enter or Space", () => {
    const onOpen = vi.fn();
    mountRow(todoRow(), { onOpen });
    const row = document.querySelector("[data-row-doc='doc_week']") as HTMLElement;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
    // Any other key is the board's business, not the row's.
    fireEvent.keyDown(row, { key: "x" });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("is inert when no host wired an open callback", () => {
    mountRow(todoRow());
    const row = document.querySelector("[data-row-doc='doc_week']") as HTMLElement;
    expect(() => {
      fireEvent.click(row);
    }).not.toThrow();
  });

  it("keeps the row's own signals: the lock chip", async () => {
    mountRow(todoRow(), {
      locks: [{ docId: "doc_week", holder: "agent", acquired: NOW.toISOString(), ttl: 300 }],
    });
    await waitFor(() => {
      expect(document.querySelector(".row-lock")).toBeTruthy();
    });
  });

  it("keeps the row's own signals: the working dot and the unread pill", () => {
    mountRow(todoRow({ awaitingAgent: true, unreadThreads: 2 }));
    expect(screen.getByText("2")).toBeTruthy();
    expect(document.querySelector(".working-dot")).toBeTruthy();
  });

  it("renders attention reason chips, and hides them when the host says so", () => {
    mountRow(todoRow({ attention: ["unread-reply"] }));
    expect(document.querySelector("[data-reason='unread-reply']")).toBeTruthy();
    cleanup();
    const wire = transport({});
    render(
      <TodoListItem row={todoRow({ attention: ["unread-reply"] })} now={NOW} showReasons={false} />,
      {
        wrapper: wrapperFor(wire).Wrapper,
      },
    );
    expect(document.querySelector("[data-reason='unread-reply']")).toBeNull();
  });

  it("carries the staleness ladder and its quick actions", () => {
    mountRow(todoRow({ stale: "very-stale" }));
    expect(document.querySelector("[data-row-level]")?.getAttribute("data-row-level")).not.toBe(
      "0",
    );
    for (const action of ["archive", "keep", "triage"]) {
      expect(document.querySelector(`[data-act='${action}']`)).toBeTruthy();
    }
    // The meta line steps aside when the quick actions take its place.
    expect(document.querySelector(".row-meta")).toBeNull();
  });

  /**
   * A quick action must not also open the document — the row is a button, and
   * the actions live inside it.
   */
  it("does not open the document when a quick action is used", () => {
    const onOpen = vi.fn();
    mountRow(todoRow({ stale: "very-stale" }), { onOpen });
    const archive = document.querySelector("[data-act='archive']") as HTMLElement;
    fireEvent.click(archive);
    fireEvent.keyDown(archive, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders a failed quick action's error inside the row", async () => {
    const wire = transport({});
    render(<TodoListItem row={todoRow({ stale: "very-stale" })} now={NOW} />, {
      wrapper: wrapperFor({
        ...wire,
        fetch: () => Promise.reject(new Error("the server refused the archive")),
      }).Wrapper,
    });
    fireEvent.click(document.querySelector("[data-act='archive']") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector(".row-error")?.textContent).toContain("refused the archive");
    });
  });

  it("shows the meta line and an age chip on a fresh row", () => {
    mountRow(todoRow());
    expect(document.querySelector(".row-meta")).toBeTruthy();
    expect(document.querySelector(".age")).toBeTruthy();
  });

  it("carries the keyboard cursor outline when the board says it is on this row", () => {
    mountRow(todoRow());
    expect(document.querySelector(".row")?.className).not.toContain("kbd");
    cleanup();
    render(<TodoListItem row={todoRow()} now={NOW} cursor />, {
      wrapper: wrapperFor(transport({})).Wrapper,
    });
    expect(document.querySelector(".row")?.className).toContain("kbd");
  });

  it("truncates long item text with CSS rather than by cutting the string", async () => {
    const long = "x".repeat(200);
    mountRow(todoRow(), { items: [item(long, false)] });
    // The full text stays in the DOM — truncation is presentational, so a
    // future anchor or a copy-paste gets the real words.
    await waitFor(() => {
      expect(previews()).toEqual([long]);
    });
    expect(document.querySelector(".todo-items .todo-item-text")).toBeTruthy();
  });
});
