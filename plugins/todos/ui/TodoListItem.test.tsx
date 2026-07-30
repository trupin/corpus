/** @vitest-environment jsdom */
import type { DocRow, Lock } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodoListItem } from "./TodoListItem.js";
import { TS, transport, wrapperFor } from "./testing.js";

afterEach(cleanup);

const NOW = new Date("2026-07-20T12:00:00.000Z");

const item = (text: string, done: boolean, due?: string): Record<string, unknown> => ({
  text,
  done,
  ts: TS,
  ...(due === undefined ? {} : { due }),
});

const todoRow = (overrides: Partial<DocRow> = {}): DocRow =>
  docRowFixture({
    id: "doc_week",
    type: "todo",
    title: "Week of Jul 20",
    path: "data/docs/todos/week.md",
    updated: "2026-07-19T09:00:00.000Z",
    extra: { items: [item("Renew passport", false), item("Send lease notice", true)] },
    ...overrides,
  });

function mountRow(
  row: DocRow,
  props: { onOpen?: (row: DocRow) => void; locks?: readonly Lock[] } = {},
): void {
  const wire = transport({ locks: props.locks ?? [] });
  render(<TodoListItem row={row} now={NOW} onOpen={props.onOpen} />, {
    wrapper: wrapperFor(wire).Wrapper,
  });
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

  it("previews the first three items with their checkboxes", () => {
    mountRow(
      todoRow({
        extra: {
          items: [item("one", false), item("two", true), item("three", false), item("four", false)],
        },
      }),
    );
    expect(previews()).toEqual(["one", "two", "three"]);
    expect([...document.querySelectorAll(".todo-items .box")].map((n) => n.textContent)).toEqual([
      "☐",
      "☑",
      "☐",
    ]);
    // The rest are counted, never listed: a row is a preview, not the list.
    expect(screen.getByText("+1 more")).toBeTruthy();
  });

  it("shows no preview and no more-affordance for an empty list", () => {
    mountRow(todoRow({ extra: { items: [] } }));
    expect(previews()).toEqual([]);
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("degrades a malformed document to no preview rather than crashing", () => {
    expect(() => {
      mountRow(todoRow({ extra: { items: "nope" } }));
    }).not.toThrow();
    expect(previews()).toEqual([]);
  });

  it("badges the number of open items carrying a deadline", () => {
    mountRow(
      todoRow({
        extra: {
          items: [item("a", false, "2026-08-01"), item("b", false), item("c", true, "2026-08-02")],
        },
      }),
    );
    expect(screen.getByText("1 due")).toBeTruthy();
  });

  it("shows no due badge when nothing open has a deadline", () => {
    mountRow(todoRow());
    expect(screen.queryByText(/due/)).toBeNull();
  });

  it("applies the overdue treatment to a past deadline", () => {
    mountRow(todoRow({ extra: { items: [item("late", false, "2026-07-10")] } }));
    expect(document.querySelector(".todo-items .t")?.className).toContain("overdue");
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
      locks: [{ docId: "doc_week", holder: "agent", acquired: TS, ttl: 300 }],
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

  it("truncates long item text with CSS rather than by cutting the string", () => {
    const long = "x".repeat(200);
    mountRow(todoRow({ extra: { items: [item(long, false)] } }));
    // The full text stays in the DOM — truncation is presentational, so a
    // future anchor or a copy-paste gets the real words.
    expect(previews()).toEqual([long]);
    expect(document.querySelector(".todo-items .todo-item-text")).toBeTruthy();
  });
});
