/** @vitest-environment jsdom */
import type { ResolvedAnchor } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sentJson,
  statefulTodoWire,
  STATEFUL_BODY as BODY,
  wrapperFor,
  type StatefulWire,
  type StatefulWireOptions,
} from "./testing.js";
import { TodosColumn } from "./TodosColumn.js";

afterEach(cleanup);

/**
 * The quick actions on a todo **item row**, end to end through the column
 * (PLUGINS-009 / sprint-023 TEST-1066–1072).
 *
 * These tests mount the real column over `statefulTodoWire` — the item routes
 * rewrite a body and `GET /lists` is recomputed from it — so "the row refreshes
 * without a reload" is an assertion about the application rather than about a
 * fixture.
 */

const NOW = new Date("2026-07-20T12:00:00.000Z");

interface Mounted {
  readonly wire: StatefulWire;
  readonly onOpen: ReturnType<typeof vi.fn>;
}

function mount(options: StatefulWireOptions = {}): Mounted {
  const wire = statefulTodoWire(options);
  const onOpen = vi.fn();
  render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} onOpen={onOpen} now={NOW} />, {
    wrapper: wrapperFor(wire).Wrapper,
  });
  return { wire, onOpen };
}

const rows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".todos-column .check:not(.todo-more)"),
];

const rowFor = (text: string): HTMLElement =>
  rows().find((node) => node.textContent?.includes(text) === true) as HTMLElement;

/**
 * The row's open control — where the keyboard sits on a row since PLUGINS-015.
 *
 * The row itself is a container now (it holds a checkbox and this), so it is not
 * the focusable thing any more; the menu opens from whichever of its controls
 * has focus and returns focus there.
 */
const openControlFor = (text: string): HTMLElement =>
  rowFor(text).querySelector<HTMLElement>(".todo-item-open") as HTMLElement;

const menu = (): HTMLElement | null => document.querySelector("[data-todo-menu]");

const act = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-todo-menu] [data-act="${id}"]`) as HTMLElement;

const settled = async (): Promise<void> => {
  await waitFor(() => {
    expect(rows().length).toBeGreaterThan(0);
  });
};

/** An anchor resolved where it lands in {@link BODY} — the item's own span. */
const anchorOn = (exact: string): ResolvedAnchor => ({
  anchorId: "anc_1",
  threadId: "th_plumber",
  threadStatus: "open",
  selector: { exact, prefix: "", suffix: "" },
  range: { start: BODY.indexOf(exact), end: BODY.indexOf(exact) + exact.length },
  orphaned: false,
});

describe("the todos column's item menu", () => {
  it("opens a Corpus menu at the pointer, and takes the browser's own", async () => {
    const { onOpen } = mount();
    await settled();
    expect(menu()).toBeNull();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientX", { value: 120 });
    Object.defineProperty(event, "clientY", { value: 240 });
    rowFor("Call the plumber").dispatchEvent(event);
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    // Refused, so the browser's menu never appears over the plugin surface.
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("aria-label")).toBe("Actions for Call the plumber");
    expect(menu()?.style.left).toBe("120px");
    // A right-click is not an open: the reader stays where it was.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the same menu from the keyboard, with its first item focused", async () => {
    mount();
    await settled();
    const row = rowFor("Call the plumber");
    openControlFor("Call the plumber").focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    expect(document.activeElement).toBe(act("toggle"));
    // The board's own ⇧F10 must not also fire on a plugin row.
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(document.querySelectorAll("[data-todo-menu]")).toHaveLength(1);
  });

  /**
   * TEST-1068. The index is the item's position in the **document**, not on
   * screen: the column hides the done item above it.
   */
  it("checks the box through the plugin's own item route, and refreshes without a reload", async () => {
    const { wire } = mount();
    await settled();
    expect(rows().map((node) => node.textContent)).toHaveLength(2);
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    fireEvent.click(act("toggle"));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(wire.pluginWrites()).toHaveLength(1);
    const write = wire.pluginWrites()[0];
    expect(new URL(write?.url ?? "http://x/").pathname).toBe("/api/x/todos/doc_week/items/2");
    expect(write?.init?.method).toBe("PUT");
    expect(sentJson(write?.init)).toEqual({
      done: true,
      expectedText: "Call the plumber",
    });
    // One line changed, and only its box.
    expect(wire.body()).toBe(BODY.replace("- [ ] Call the plumber", "- [x] Call the plumber"));
    expect(screen.queryByText("Call the plumber")).toBeNull();
    expect(screen.getByText("Book the passport appointment")).toBeTruthy();
  });

  /** TEST-1069: a stale index is refused, and the refusal is told to the user. */
  it("surfaces a refused write instead of failing silently", async () => {
    const { wire } = mount({ itemStatus: 409 });
    await settled();
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    fireEvent.click(act("toggle"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("it changed under you");
    });
    expect(wire.body()).toBe(BODY);
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the item's existing thread through the reveal seam", async () => {
    const { onOpen } = mount({ anchors: [anchorOn("Call the plumber")] });
    await settled();
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(act("open-thread")).toBeTruthy();
    });
    fireEvent.click(act("open-thread"));
    expect(onOpen).toHaveBeenCalledWith({
      docId: "doc_week",
      reveal: { kind: "thread", threadId: "th_plumber" },
    });
  });

  it("shows no thread action for an item that has none", async () => {
    mount();
    await settled();
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    expect(document.querySelectorAll("[data-todo-menu] [role='menuitem']")).toHaveLength(2);
  });

  /**
   * The whole comment path from the row: menu → composer → an ordinary §6
   * thread → the reader, open at the comment that was just made.
   */
  it("comments on an item and takes the user to the thread it created", async () => {
    const { wire, onOpen } = mount();
    await settled();
    fireEvent.contextMenu(rowFor("Call the plumber"));
    await waitFor(() => {
      expect(act("comment").hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(act("comment"));
    await waitFor(() => {
      expect(document.querySelector("[data-todo-comment]")).not.toBeNull();
    });
    // The menu is gone; one floating surface at a time.
    expect(menu()).toBeNull();
    expect(screen.getByText("“Call the plumber”")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "which plumber was it?" },
    });
    fireEvent.click(screen.getByText("Comment ⌘↵"));
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith({
        docId: "doc_week",
        reveal: { kind: "thread", threadId: "th_new1" },
      });
    });
    expect(document.querySelector("[data-todo-comment]")).toBeNull();

    const posted = wire.calls.find((call) => call.url.endsWith("/api/threads"));
    expect(posted).toBeDefined();
    // The document was read once for the selector, and the write went to core's
    // own thread route — the plugin invents no thread shape of its own.
    expect(wire.pluginWrites()).toEqual([]);
  });

  it("closes on Escape, opens nothing, and leaves the keyboard where it was", async () => {
    const { onOpen } = mount();
    await settled();
    const row = rowFor("Call the plumber");
    openControlFor("Call the plumber").focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    fireEvent.keyDown(menu() as HTMLElement, { key: "Escape" });
    await waitFor(() => {
      expect(menu()).toBeNull();
    });
    expect(onOpen).not.toHaveBeenCalled();
    // Focus goes back to the control the menu was opened from, not onto the body.
    expect(document.activeElement).toBe(openControlFor("Call the plumber"));
  });
});
