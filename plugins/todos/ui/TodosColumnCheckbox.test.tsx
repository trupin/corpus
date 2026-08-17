/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  memoryStorage,
  sentJson,
  statefulTodoWire,
  STATEFUL_BODY as BODY,
  wrapperFor,
  type StatefulWire,
  type StatefulWireOptions,
} from "./testing.js";
import { TodosColumn } from "./TodosColumn.js";
import { TODOS_STORAGE_KEY } from "./showCompleted.js";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The box on a Todos column row checks the item (PLUGINS-015).
 *
 * Every test here mounts the real column over `statefulTodoWire`, so a row
 * leaving the column is the aggregate having been re-read after a write the
 * server actually applied — not the column hiding a row it hopes was written.
 * The distinction is the issue's third acceptance criterion, and a fixture that
 * answered a canned list could not tell the two apart.
 */

const NOW = new Date("2026-07-20T12:00:00.000Z");

interface Mounted {
  readonly wire: StatefulWire;
  readonly onOpen: ReturnType<typeof vi.fn>;
}

function mount(options: StatefulWireOptions = {}, now: Date = NOW): Mounted {
  const wire = statefulTodoWire(options);
  const onOpen = vi.fn();
  render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} onOpen={onOpen} now={now} />, {
    wrapper: wrapperFor(wire).Wrapper,
  });
  return { wire, onOpen };
}

const rows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".todos-column .check:not(.todo-more)"),
];

const rowFor = (text: string): HTMLElement =>
  rows().find((node) => node.textContent?.includes(text) === true) as HTMLElement;

const boxFor = (text: string): HTMLElement =>
  rowFor(text).querySelector<HTMLElement>(".box") as HTMLElement;

const openControlFor = (text: string): HTMLElement =>
  rowFor(text).querySelector<HTMLElement>(".todo-item-open") as HTMLElement;

const showCompleted = (): HTMLElement =>
  document.querySelector<HTMLElement>("[data-todos-show-completed]") as HTMLElement;

const settled = async (): Promise<void> => {
  await waitFor(() => {
    expect(rows().length).toBeGreaterThan(0);
  });
};

describe("the checkbox on a Todos column row", () => {
  /**
   * The reported defect, from the other side: the box used to be an inert
   * `<span>` inside the row's one `<button>`, so a click on it opened the
   * document and left the item open.
   */
  it("checks the item and does not open the document", async () => {
    const { wire, onOpen } = mount();
    await settled();
    expect(rows()).toHaveLength(2);

    fireEvent.click(boxFor("Call the plumber"));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(wire.pluginWrites()).toHaveLength(1);
    const write = wire.pluginWrites()[0];
    expect(new URL(write?.url ?? "http://x/").pathname).toBe("/api/x/todos/doc_week/items/2");
    expect(write?.init?.method).toBe("PUT");
    expect(sentJson(write?.init)).toEqual({ done: true, expectedText: "Call the plumber" });
    // One line changed, and only its box.
    expect(wire.body()).toBe(BODY.replace("- [ ] Call the plumber", "- [x] Call the plumber"));
  });

  it("opens the document at the item when the rest of the row is clicked", async () => {
    const { wire, onOpen } = mount();
    await settled();

    fireEvent.click(openControlFor("Call the plumber"));

    expect(onOpen).toHaveBeenCalledWith({
      docId: "doc_week",
      reveal: {
        kind: "item",
        exact: "Call the plumber",
        prefix: "Book the passport appointment (due: 2026-08-01)",
      },
    });
    // Opening is not a write.
    expect(wire.pluginWrites()).toEqual([]);
    expect(wire.body()).toBe(BODY);
  });

  /** SPEC.md §11: "§11 adds no exclusive-pointer capability". */
  it("checks the item from the keyboard", async () => {
    const { wire, onOpen } = mount();
    await settled();
    const box = boxFor("Call the plumber");
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");

    box.focus();
    expect(document.activeElement).toBe(box);
    // A focused button's own default action — the browser turns ↵ and space
    // into a click, which is why the plugin re-implements neither.
    fireEvent.click(box);

    await waitFor(() => {
      expect(wire.pluginWrites()).toHaveLength(1);
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("leaves the box in its true state when the write is refused", async () => {
    const { wire } = mount({ itemStatus: 409 });
    await settled();

    fireEvent.click(boxFor("Call the plumber"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("it changed under you");
    });
    expect(wire.body()).toBe(BODY);
    expect(rows()).toHaveLength(2);
    // Not "unchecked again after a flicker": it was never drawn checked.
    expect(boxFor("Call the plumber").getAttribute("aria-checked")).toBe("false");
    expect(boxFor("Call the plumber").textContent).toBe("☐");

    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * A double-click sends the value it wants rather than an increment, so the
   * second write re-applies the first (`itemActions.ts` argues this at length).
   * What must never happen is the box toggling back.
   */
  it("survives a rapid double click on the box without flipping back", async () => {
    const { wire } = mount();
    await settled();
    const box = boxFor("Call the plumber");

    fireEvent.click(box);
    fireEvent.click(box);

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(wire.pluginWrites().map((call) => sentJson(call.init))).toEqual([
      { done: true, expectedText: "Call the plumber" },
      { done: true, expectedText: "Call the plumber" },
    ]);
    expect(wire.body()).toBe(BODY.replace("- [ ] Call the plumber", "- [x] Call the plumber"));
  });

  it("gives the +N more row no checkbox", async () => {
    const many = Array.from({ length: 8 }, (_e, index) => `- [ ] item ${String(index)}`).join("\n");
    mount({ body: `${many}\n` });
    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    const more = document.querySelector<HTMLElement>(".todos-column .todo-more");
    expect(more?.textContent).toBe("+3 more");
    expect(more?.querySelector(".box")).toBeNull();
    expect(document.querySelectorAll('.todos-column [role="checkbox"]')).toHaveLength(5);
  });

  /** The class rides the row, which is a different element than it used to be. */
  it("keeps the overdue treatment on the row through the restructure", async () => {
    mount({}, new Date("2026-08-16T12:00:00.000Z"));
    await settled();
    expect(rowFor("Book the passport appointment").className).toContain("overdue");
    expect(rowFor("Call the plumber").className).not.toContain("overdue");
    expect(
      rowFor("Book the passport appointment").querySelector(".due")?.getAttribute("data-overdue"),
    ).toBe("true");
    // And checking it from the box still works while it is overdue.
    fireEvent.click(boxFor("Book the passport appointment"));
    await waitFor(() => {
      expect(screen.queryByText("Book the passport appointment")).toBeNull();
    });
  });

  it("still opens the item menu on right-click", async () => {
    const { onOpen } = mount();
    await settled();
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(document.querySelector("[data-todo-menu]")).not.toBeNull();
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the menu from a right-click on the box itself", async () => {
    mount();
    await settled();
    // The container carries the handler; the box is inside it, so the event
    // bubbles — a right-click anywhere on the row gets the row's menu.
    fireEvent.contextMenu(boxFor("Call the plumber"));
    await waitFor(() => {
      expect(document.querySelector("[data-todo-menu]")?.getAttribute("aria-label")).toBe(
        "Actions for Call the plumber",
      );
    });
  });
});

describe("the Todos column's show-completed control", () => {
  it("shows completed items on request, and unchecking one from there works", async () => {
    const { wire } = mount();
    await settled();
    expect(screen.queryByText("Send the signed form")).toBeNull();
    expect(showCompleted().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(showCompleted());

    await waitFor(() => {
      expect(screen.getByText("Send the signed form")).toBeTruthy();
    });
    expect(showCompleted().textContent).toBe("Hide completed");
    const done = boxFor("Send the signed form");
    expect(done.getAttribute("aria-checked")).toBe("true");
    expect(done.textContent).toBe("☑");

    fireEvent.click(done);

    await waitFor(() => {
      expect(boxFor("Send the signed form").getAttribute("aria-checked")).toBe("false");
    });
    expect(sentJson(wire.pluginWrites()[0]?.init)).toEqual({
      done: false,
      expectedText: "Send the signed form",
    });
    expect(wire.body()).toBe(
      BODY.replace("- [x] Send the signed form", "- [ ] Send the signed form"),
    );
  });

  /**
   * The case the control exists for: the last open item is checked from the
   * column, every row disappears, and the way back to it is still on screen.
   */
  it("stays on screen when the column has nothing left to show", async () => {
    mount({ body: "- [ ] The only thing left\n" });
    await settled();

    fireEvent.click(boxFor("The only thing left"));

    await waitFor(() => {
      expect(screen.getByText(/Every todo list is clear/)).toBeTruthy();
    });
    fireEvent.click(showCompleted());
    await waitFor(() => {
      expect(screen.getByText("The only thing left")).toBeTruthy();
    });
    expect(boxFor("The only thing left").getAttribute("aria-checked")).toBe("true");
  });

  /**
   * Browser-local, per the rider: nothing about looking at completed items is
   * written to the corpus, so no document write leaves the column.
   */
  it("records the choice in browser-local storage and not in the view document", async () => {
    const { wire } = mount();
    await settled();
    fireEvent.click(showCompleted());
    await waitFor(() => {
      expect(screen.getByText("Send the signed form")).toBeTruthy();
    });

    expect(JSON.parse(globalThis.localStorage.getItem(TODOS_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      showCompleted: ["doc_col"],
    });
    const writes = wire.calls.filter((call) => (call.init?.method ?? "GET") !== "GET");
    expect(writes).toEqual([]);

    // Turning it off removes the entry rather than storing the default.
    fireEvent.click(showCompleted());
    expect(JSON.parse(globalThis.localStorage.getItem(TODOS_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      showCompleted: [],
    });
  });

  it("comes back showing completed items after a remount", async () => {
    globalThis.localStorage.setItem(
      TODOS_STORAGE_KEY,
      JSON.stringify({ version: 1, showCompleted: ["doc_col"] }),
    );
    mount();
    await waitFor(() => {
      expect(screen.getByText("Send the signed form")).toBeTruthy();
    });
    expect(showCompleted().getAttribute("aria-pressed")).toBe("true");
  });

  it("says so plainly when there is nothing at all to show", async () => {
    mount({ body: "Just prose, no items.\n" });
    await waitFor(() => {
      expect(screen.getByText(/Every todo list is clear/)).toBeTruthy();
    });
    fireEvent.click(showCompleted());
    expect(screen.getByText("No todo items anywhere yet.")).toBeTruthy();
  });
});
