/** @vitest-environment jsdom */
import type { ResolvedAnchor } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openItems, parseBodyItems, updateItemInBody, type TodoItem } from "../items.js";
import { wrapperFor, type RecordedCall, type Transport } from "./testing.js";
import { TodosColumn } from "./TodosColumn.js";

afterEach(cleanup);

/**
 * The quick actions on a todo **item row**, end to end through the column
 * (PLUGINS-009 / sprint-023 TEST-1066–1072).
 *
 * These tests mount the real column over a **stateful** transport: the item
 * routes rewrite a body, and `GET /lists` is recomputed from that body every
 * time it is asked. That is what makes "the row refreshes without a reload" an
 * assertion about the application rather than about a fixture — a column that
 * did not re-read would keep showing the item it just checked off.
 */

const NOW = new Date("2026-07-20T12:00:00.000Z");

const BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [x] Send the signed form",
  "- [ ] Book the passport appointment (due: 2026-08-01)",
  "- [ ] Call the plumber",
  "",
].join("\n");

interface Wire extends Transport {
  /** The document body as the stub currently holds it. */
  body(): string;
  readonly pluginWrites: () => readonly RecordedCall[];
}

interface WireOptions {
  /** Status the item route answers with; 200 applies the write. */
  readonly itemStatus?: number;
  readonly anchors?: readonly ResolvedAnchor[];
}

/** The JSON a recorded call carried, which `pluginRequest` always sends as a string. */
function sentJson(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

/** A transport that actually applies the plugin's item writes to a body. */
function statefulWire(options: WireOptions = {}): Wire {
  let body = BODY;
  const calls: RecordedCall[] = [];
  const status = options.itemStatus ?? 200;

  const json = (value: unknown, code: number): Response =>
    new Response(JSON.stringify(value), {
      status: code,
      headers: { "content-type": "application/json" },
    });

  const listView = (): Record<string, unknown> => {
    const items: readonly TodoItem[] = parseBodyItems(body);
    return {
      docId: "doc_week",
      title: "Week of Jul 20",
      path: "data/docs/todos/doc_week.md",
      status: "open",
      open: openItems(items).length,
      done: items.length - openItems(items).length,
      items,
    };
  };

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");

    if (path.startsWith("/api/x/todos/lists")) {
      return Promise.resolve(json({ lists: [listView()] }, 200));
    }

    const item = /^\/api\/x\/todos\/([^/]+)\/items\/(\d+)$/.exec(path);
    if (item !== null && method === "PUT") {
      if (status !== 200) {
        return Promise.resolve(
          json({ code: "conflict", message: "it changed under you; nothing was written" }, status),
        );
      }
      body = updateItemInBody(body, Number(item[2]), sentJson(init));
      return Promise.resolve(json({ docId: item[1], index: Number(item[2]) }, 200));
    }

    if (path === "/api/threads" && method === "POST") {
      return Promise.resolve(
        json({ thread: { id: "th_new1" }, anchorId: "anc_new1", warnings: [] }, 201),
      );
    }
    if (path === "/api/locks") return Promise.resolve(json({ locks: [] }, 200));
    if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }, 200));
    if (path.startsWith("/api/docs/")) {
      return Promise.resolve(
        json(
          {
            frontmatter: {
              id: "doc_week",
              type: "todo",
              title: "Week of Jul 20",
              created: "2026-07-20T09:00:00.000Z",
              updated: "2026-07-20T09:00:00.000Z",
              tags: [],
              status: "open",
              anchors: {},
              due: null,
              reviewed: null,
              evergreen: false,
              pinned: false,
              order: null,
              query: null,
              column: null,
              extra: {},
            },
            body,
            path: "data/docs/todos/doc_week.md",
            anchors: options.anchors ?? [],
          },
          200,
        ),
      );
    }
    const rows = [docRowFixture({ id: "doc_week", type: "todo", title: "Week of Jul 20" })];
    return Promise.resolve(json({ items: rows, page: { total: 1, limit: 50, offset: 0 } }, 200));
  };

  return {
    fetch: fetchStub,
    calls,
    body: () => body,
    pluginCalls: () => calls.filter((call) => call.url.includes("/api/x/todos")),
    pluginWrites: () => calls.filter((call) => /\/api\/x\/todos\/[^/]+\/items\//.test(call.url)),
  };
}

interface Mounted {
  readonly wire: Wire;
  readonly onOpen: ReturnType<typeof vi.fn>;
}

function mount(options: WireOptions = {}): Mounted {
  const wire = statefulWire(options);
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
    row.focus();
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
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    fireEvent.keyDown(menu() as HTMLElement, { key: "Escape" });
    await waitFor(() => {
      expect(menu()).toBeNull();
    });
    expect(onOpen).not.toHaveBeenCalled();
    // Focus goes back to the row the menu was opened on, not onto the body.
    expect(document.activeElement).toBe(rowFor("Call the plumber"));
  });
});
