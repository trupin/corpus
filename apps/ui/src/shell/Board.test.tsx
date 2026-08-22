/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardTransport, viewRow, type BoardTransport } from "../testing/boardFixture";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { KeyboardHarness } from "../testing/keyboardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { BOARD_STORAGE_KEY } from "../board/useBoardLocalState";
import { DELETE_ARMED_LABEL, DELETE_LABEL } from "../reader/DocMenu";
import { Board } from "./Board";
import { ToastProvider } from "./Toasts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

const VIEWS = [
  viewRow({ id: "doc_one", title: "First", order: 10, query: { folder: "inbox" } }),
  viewRow({ id: "doc_two", title: "Second", order: 20, query: { type: "thread" } }),
  viewRow({ id: "doc_three", title: "Third", order: 30 }),
];

function renderBoard(wire: BoardTransport): ReturnType<typeof render> {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Wrapper({ children }: { readonly children?: React.ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ToastProvider>
          <ContextMenuProvider>
            <KeyboardHarness>{children}</KeyboardHarness>
          </ContextMenuProvider>
        </ToastProvider>
      </harness.Wrapper>
    );
  }
  return render(<Board />, { wrapper: Wrapper });
}

/** Lays the columns out so the drag arithmetic has real geometry to read. */
function layOutColumns(container: HTMLElement): void {
  for (const [index, element] of [
    ...container.querySelectorAll<HTMLElement>(".col[data-col]"),
  ].entries()) {
    element.getBoundingClientRect = () =>
      ({ left: index * 350, width: 336, right: index * 350 + 336 }) as DOMRect;
  }
}

/** jsdom builds no `DataTransfer`; the handlers read one, so the test supplies it. */
const dataTransfer = (): { readonly dataTransfer: unknown } => ({
  dataTransfer: { dropEffect: "", effectAllowed: "", setData: () => undefined },
});

/**
 * jsdom implements no `DragEvent`, so `fireEvent.dragOver` falls back to a plain
 * `Event` and silently drops `clientX` — the one property the insertion
 * arithmetic reads. A `MouseEvent` carries it, and React reads the coordinate
 * off the native event either way.
 */
function dragEventAt(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer().dataTransfer });
  return event;
}

const titles = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".col[data-col] .col-title")].map(
    (node) => node.textContent ?? "",
  );

describe("Board", () => {
  it("renders a labelled main scroller carrying the board class", () => {
    const { container } = renderBoard(boardTransport({ views: [] }));
    const board = container.querySelector(".board");
    expect(board?.tagName).toBe("MAIN");
    expect(board?.getAttribute("aria-label")).toBe("Document lists");
  });

  it("renders one column per pinned view document, in board order", async () => {
    const { container } = renderBoard(boardTransport({ views: VIEWS }));
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });
    expect(titles(container)).toEqual(["First", "Second", "Third"]);
  });

  it("is a ghost column and never a blank screen when nothing is pinned", async () => {
    const { container } = renderBoard(boardTransport({ views: [] }));
    await waitFor(() => {
      expect(container.querySelector(".ghost-col")).not.toBeNull();
    });
    expect(container.querySelectorAll(".col[data-col]")).toHaveLength(0);
    expect(container.querySelector(".ghost-col")?.textContent).toContain(
      "New list — a folder, a view, or any filter",
    );
  });

  it("drives each column's rows from that column's own stored query", async () => {
    const wire = boardTransport({
      views: VIEWS,
      rows: {
        "?folder=inbox": [docRowFixture({ id: "doc_r1", title: "Captured note" })],
        "?type=thread": [docRowFixture({ id: "doc_r2", title: "A conversation" })],
      },
    });
    const { container } = renderBoard(wire);

    await waitFor(() => {
      expect(screen.getByText("Captured note")).toBeDefined();
    });
    expect(screen.getByText("A conversation")).toBeDefined();
    const first = container.querySelector('.col[data-col="doc_one"]');
    expect(first?.querySelector(".col-count")?.textContent).toBe("1");
    expect(first?.querySelectorAll(".row")).toHaveLength(1);
  });

  it("moves the active column with ⇧→ and writes the view document's order", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    // The first column is active by default and carries the cue.
    expect(container.querySelector(".col.kactive")?.getAttribute("data-col")).toBe("doc_one");
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]).toMatchObject({
      path: "/api/docs/doc_one",
      body: { order: 25 },
    });
    // Rendered from the moved set, not from an imperative DOM insertion.
    expect(titles(container)).toEqual(["Second", "First", "Third"]);
  });

  it("is a silent no-op at either end — no request, no write", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.keyDown(document, { key: "ArrowLeft", shiftKey: true });
    fireEvent.mouseOver(container.querySelector('.col[data-col="doc_three"]') as Element);
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true });

    expect(wire.writes("PUT")).toEqual([]);
    expect(titles(container)).toEqual(["First", "Second", "Third"]);
  });

  it("ignores ⇧← while the caret is in a field", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /List options/ })[1] as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const field = screen.getByLabelText("Rename Second");
    fireEvent.keyDown(field, { key: "ArrowLeft", shiftKey: true });

    expect(wire.writes("PUT")).toEqual([]);
  });

  it("follows hover for the active-column cue", async () => {
    const { container } = renderBoard(boardTransport({ views: VIEWS }));
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.mouseOver(container.querySelector('.col[data-col="doc_two"]') as Element);
    expect(container.querySelector(".col.kactive")?.getAttribute("data-col")).toBe("doc_two");
  });

  it("reorders by dragging the header, midpoint by midpoint, and persists on drop", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });
    layOutColumns(container);

    const third = container.querySelector('.col[data-col="doc_three"]') as HTMLElement;
    const board = container.querySelector(".board") as HTMLElement;

    fireEvent.mouseDown(third.querySelector(".col-head") as Element);
    expect(third.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(third, dataTransfer());
    expect(third.className).toContain("dragging");

    // Just left of the first column's midpoint (168) → lands first.
    fireEvent(board, dragEventAt("dragover", 100));
    expect(titles(container)).toEqual(["Third", "First", "Second"]);
    // Just right of it → lands second.
    fireEvent(board, dragEventAt("dragover", 200));
    expect(titles(container)).toEqual(["First", "Third", "Second"]);

    fireEvent(board, dragEventAt("drop", 200));
    fireEvent.dragEnd(third, dataTransfer());

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]).toMatchObject({
      path: "/api/docs/doc_three",
      body: { order: 15 },
    });
  });

  it("persists nothing when the drag ends outside the board", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });
    layOutColumns(container);

    const third = container.querySelector('.col[data-col="doc_three"]') as HTMLElement;
    const board = container.querySelector(".board") as HTMLElement;
    fireEvent.dragStart(third, dataTransfer());
    fireEvent(board, dragEventAt("dragover", 100));
    expect(titles(container)).toEqual(["Third", "First", "Second"]);

    // Released over nothing: no `drop` reaches the board.
    fireEvent.dragEnd(third, dataTransfer());

    expect(wire.writes("PUT")).toEqual([]);
    expect(titles(container)).toEqual(["First", "Second", "Third"]);
  });

  it("restores the pre-drag order on Escape", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });
    layOutColumns(container);

    const third = container.querySelector('.col[data-col="doc_three"]') as HTMLElement;
    const board = container.querySelector(".board") as HTMLElement;
    fireEvent.dragStart(third, dataTransfer());
    fireEvent(board, dragEventAt("dragover", 100));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(titles(container)).toEqual(["First", "Second", "Third"]);
    fireEvent.dragEnd(third, dataTransfer());
    expect(wire.writes("PUT")).toEqual([]);
  });

  it("pins a chosen list by creating a view document with order last", async () => {
    const wire = boardTransport({
      views: VIEWS,
      tree: {
        folders: [{ path: "finance", name: "finance", count: 2, totalCount: 2, children: [] }],
      },
    });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /finance/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /finance/ }));

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "view",
      title: "finance",
      folder: "views",
      pinned: true,
      order: 40,
      query: { folder: "finance" },
      evergreen: true,
    });
    expect(await screen.findByText(/Pinned — a view document was created/)).toBeDefined();
  });

  it("creates into the folder a folder column scopes to, and opens it with the title selected", async () => {
    const wire = boardTransport({
      views: [
        viewRow({ id: "doc_fin", title: "Finance", order: 10, query: { folder: "finance" } }),
      ],
    });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /New document in Finance/ }));

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "note",
      title: "Untitled",
      folder: "finance",
    });

    const field = await screen.findByLabelText("Document title");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect((field as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((field as HTMLTextAreaElement).selectionEnd).toBe(
      (field as HTMLTextAreaElement).value.length,
    );
  });

  it("creates into inbox from a column that is not folder-scoped", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getByRole("button", { name: /New document in Second/ }));
    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    // A non-folder column creates into the inbox, and says so on the wire
    // rather than leaving it to a default in another package.
    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "note",
      title: "Untitled",
      folder: "inbox",
    });
  });

  it("unpins by archiving the view document, never by deleting it", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /List options/ })[0] as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: /Unpin/ }));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]).toMatchObject({
      path: "/api/docs/doc_one",
      body: { status: "archived" },
    });
    expect(wire.writes("DELETE")).toEqual([]);
    expect(await screen.findByText(/was archived, not deleted/)).toBeDefined();
  });

  it("writes a renamed title and an edited query to the view document", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /List options/ })[0] as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const nameField = screen.getByLabelText("Rename First");
    fireEvent.change(nameField, { target: { value: "Captured" } });
    fireEvent.keyDown(nameField, { key: "Enter" });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.body).toEqual({ title: "Captured" });

    fireEvent.click(screen.getAllByRole("button", { name: /List options/ })[0] as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit query/ }));
    const queryField = screen.getByLabelText("Edit query for First");
    fireEvent.change(queryField, { target: { value: "folder=finance&tag=housing" } });
    fireEvent.keyDown(queryField, { key: "Enter" });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(2);
    });
    expect(wire.writes("PUT")[1]?.body).toEqual({
      query: { folder: "finance", tag: "housing" },
    });
  });

  it("clears the stored query when every filter is removed", async () => {
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /List options/ })[0] as Element);
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit query/ }));
    const field = screen.getByLabelText("Edit query for First");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.body).toEqual({ query: null });
  });

  it("shows a column whose view document is unreadable in place, and keeps its siblings working", async () => {
    const wire = boardTransport({
      views: [
        VIEWS[0] as never,
        viewRow({
          id: "doc_bad",
          title: "Broken",
          order: 20,
          query: "needs=me" as never,
        }),
      ],
      rows: { "?folder=inbox": [docRowFixture({ id: "doc_r1", title: "A note" })] },
    });
    const { container } = renderBoard(wire);

    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(2);
    });
    const broken = container.querySelector('.col[data-col="doc_bad"]');
    expect(broken?.querySelector(".col-card-error")?.textContent).toContain("doc_bad");
    expect(broken?.querySelector(".col-card-error")?.textContent).toContain("not a map of filters");
    // The broken column issued no query of its own…
    expect(wire.calls.filter((call) => call.path === "/api/docs")).toHaveLength(2);
    // …and its sibling still renders.
    expect(await screen.findByText("A note")).toBeDefined();
  });

  /**
   * A `column:` reference used to name a plugin's own column renderer, and a
   * view carrying one got that renderer or a "plugin missing" card in its place.
   * The plugin system is gone (SHARED-064): a view document is a query, whatever
   * else its frontmatter happens to say, so an old one still renders as the
   * ordinary column it always was underneath.
   */
  it("renders a view document carrying a stale `column:` as an ordinary column", async () => {
    const wire = boardTransport({
      views: [
        viewRow({
          id: "doc_todos",
          title: "Todos",
          order: 10,
          column: "todos/board",
          query: { type: "todo" },
        }),
      ],
      rows: { "?type=todo": [docRowFixture({ id: "doc_t1", title: "Inbox chores" })] },
    });
    const { container } = renderBoard(wire);

    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(1);
    });
    expect(container.querySelector(".col-kind")?.textContent).toBe("view");
    expect(await screen.findByText("Inbox chores")).toBeDefined();
  });

  it("fails a column's query in place while its siblings keep rendering", async () => {
    const wire = boardTransport({
      views: VIEWS,
      rows: { "?folder=inbox": [docRowFixture({ id: "doc_r1", title: "A note" })] },
      failing: { "/api/docs?type=thread": 400 },
    });
    const { container } = renderBoard(wire);

    await waitFor(() => {
      expect(container.querySelector('.col[data-col="doc_two"] .col-card-error')).not.toBeNull();
    });
    expect(await screen.findByText("A note")).toBeDefined();
  });

  it("reports a failed column-set read instead of pretending the board is empty", async () => {
    const failing = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { container } = render(
      <ToastProvider>
        <ContextMenuProvider>
          <Board />
        </ContextMenuProvider>
      </ToastProvider>,
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(container.querySelector(".board-error")).not.toBeNull();
    });
    expect(container.querySelector(".ghost-col")).not.toBeNull();
  });

  it("keeps scroll and open readers locally, and nothing else", async () => {
    const wire = boardTransport({
      views: VIEWS,
      rows: { "?folder=inbox": [docRowFixture({ id: "doc_r1", title: "A note" })] },
    });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(screen.getByText("A note")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /note: A note/ }));
    await waitFor(() => {
      expect(container.querySelector(".reader")).not.toBeNull();
    });

    const blob = globalThis.localStorage.getItem(BOARD_STORAGE_KEY) ?? "";
    expect(JSON.parse(blob)).toEqual({
      version: 2,
      columns: { doc_one: { scroll: 0, nav: [{ docId: "doc_r1", scrollY: 0 }] } },
    });
    expect(blob).not.toContain("folder");
    expect(blob).not.toContain("order");
  });

  it("drops the local entry of a column that leaves the board", async () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [BOARD_STORAGE_KEY]: JSON.stringify({
          version: 2,
          columns: {
            doc_gone: { scroll: 40, nav: [{ docId: "doc_x", scrollY: 0 }] },
            doc_one: { scroll: 0, nav: [] },
          },
        }),
      }),
    );
    const wire = boardTransport({ views: VIEWS });
    const { container } = renderBoard(wire);

    await waitFor(() => {
      expect(container.querySelectorAll(".col[data-col]")).toHaveLength(3);
    });
    await waitFor(() => {
      const stored = JSON.parse(globalThis.localStorage.getItem(BOARD_STORAGE_KEY) ?? "{}") as {
        columns: Record<string, unknown>;
      };
      expect(Object.keys(stored.columns)).toEqual(["doc_one"]);
    });
  });
});

/**
 * SPEC.md §10's scheme, exercised through real key events over a real board.
 *
 * Every assertion here is about what the *board* does with a binding; that the
 * binding exists, is documented and is suppressed inside writing surfaces is
 * `keyboard/`'s business, and is tested there. What cannot be tested there is
 * the part these prove: that the registry's acts land on the board's state and
 * on the wire.
 */
describe("the board's keyboard", () => {
  const ROWS = {
    "?folder=inbox": [
      docRowFixture({ id: "doc_r1", title: "First note" }),
      docRowFixture({ id: "doc_r2", title: "Second note" }),
    ],
  };

  const cursorRow = (container: HTMLElement): string | undefined =>
    container.querySelector<HTMLElement>(".row.kbd")?.dataset["rowDoc"];

  async function withRows(): Promise<{ wire: BoardTransport; container: HTMLElement }> {
    const wire = boardTransport({ views: VIEWS, rows: ROWS });
    const { container } = renderBoard(wire);
    await waitFor(() => {
      expect(screen.getByText("First note")).toBeDefined();
    });
    return { wire, container };
  }

  it("moves the row cursor with ↓ and j, outlining exactly one row", async () => {
    const { container } = await withRows();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(container.querySelectorAll(".row.kbd")).toHaveLength(1);
    expect(cursorRow(container)).toBe("doc_r1");

    fireEvent.keyDown(document, { key: "j" });
    expect(cursorRow(container)).toBe("doc_r2");
    fireEvent.keyDown(document, { key: "k" });
    expect(cursorRow(container)).toBe("doc_r1");
  });

  it("clamps the cursor at both ends", async () => {
    const { container } = await withRows();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(cursorRow(container)).toBe("doc_r1");
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(cursorRow(container)).toBe("doc_r2");
  });

  it("↵ opens the highlighted document in its own column", async () => {
    const { container } = await withRows();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => {
      expect(container.querySelector('.reader[data-reader-column="doc_one"]')).not.toBeNull();
    });
    expect(container.querySelector(".reader")?.getAttribute("data-reader-doc")).toBe("doc_r1");
    expect(container.querySelector(".focus.open")).toBeNull();
  });

  it("⇧↵ opens it directly in full screen, over its column", async () => {
    const { container } = await withRows();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter", shiftKey: true });
    await waitFor(() => {
      expect(document.querySelector(".focus.open")).not.toBeNull();
    });
    expect(container.querySelector('.reader[data-reader-column="doc_one"]')).not.toBeNull();
  });

  it("← and → switch the active column, clamping at both ends", async () => {
    const { container } = await withRows();
    const activeColumn = (): string | null | undefined =>
      container.querySelector(".col.kactive")?.getAttribute("data-col");
    expect(activeColumn()).toBe("doc_one");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(activeColumn()).toBe("doc_two");
    fireEvent.keyDown(document, { key: "]" });
    expect(activeColumn()).toBe("doc_three");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(activeColumn()).toBe("doc_three");

    fireEvent.keyDown(document, { key: "[" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(activeColumn()).toBe("doc_one");
    expect(container.querySelectorAll(".col.kactive")).toHaveLength(1);
  });

  /**
   * UI-020, Adjudication 7: every surface that archives goes through the one
   * route. This used to send `PUT {status: "archived"}`, which for a skill sets
   * the frontmatter key and leaves the folder in `.claude/skills/`.
   */
  it("e archives the row under the cursor, through the route that owns the transition", async () => {
    const { wire, container } = await withRows();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(cursorRow(container)).toBe("doc_r1");
    fireEvent.keyDown(document, { key: "e" });

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.path).toBe("/api/docs/doc_r1/archive");
    expect(wire.writes("PUT")).toHaveLength(0);
    expect(screen.getByText(/Archived/)).toBeDefined();
  });

  it("e archives the open document in preference to the cursor", async () => {
    const { wire, container } = await withRows();
    fireEvent.click(screen.getByRole("button", { name: /note: Second note/ }));
    await waitFor(() => {
      expect(container.querySelector(".reader")).not.toBeNull();
    });
    // `e` targets the open document, so it waits for the document rather than
    // silently archiving the row behind it.
    fireEvent.keyDown(document, { key: "e" });
    await waitFor(() => {
      expect(screen.getByText(/Still opening/)).toBeDefined();
    });
    await waitFor(() => {
      expect(container.querySelector(".doc-title, .fm-title, input[name=title]")).not.toBeNull();
    });
    fireEvent.keyDown(document, { key: "e" });
    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.path).toBe("/api/docs/doc_r2/archive");
  });

  it("e says so rather than writing when there is nothing to archive", async () => {
    const { wire } = await withRows();
    fireEvent.keyDown(document, { key: "e" });
    await waitFor(() => {
      expect(screen.getByText(/Nothing to archive/)).toBeDefined();
    });
    expect(wire.writes("PUT")).toHaveLength(0);
    expect(wire.writes("POST")).toHaveLength(0);
  });

  it("f toggles focus mode on the open document, and is a no-op on nothing", async () => {
    const { container } = await withRows();
    fireEvent.keyDown(document, { key: "f" });
    expect(document.querySelector(".focus.open")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /note: First note/ }));
    await waitFor(() => {
      expect(container.querySelector(".reader")).not.toBeNull();
    });
    fireEvent.keyDown(document, { key: "f" });
    await waitFor(() => {
      expect(document.querySelector(".focus.open")).not.toBeNull();
    });
    fireEvent.keyDown(document, { key: "f" });
    await waitFor(() => {
      expect(document.querySelector(".focus.open")).toBeNull();
    });
  });

  /**
   * UI-031, from the UI-022 evaluation: seven dead `esc` presses that survived a
   * reload and came back the moment the mouse was wiggled.
   *
   * Closing full screen unmounts a full-viewport overlay, and the column that
   * was under the resting cursor the whole time fires `mouseover` on the way
   * out. Hover-follows-active then handed the board to a column the user never
   * pointed at — and `Reader`'s escape layer is live only on the *active*
   * column, so `esc` had nothing left to close. The pointer's position is
   * ignored until it actually moves.
   */
  describe("closing full screen with the pointer parked over another column", () => {
    const activeColumn = (container: HTMLElement): string | null | undefined =>
      container.querySelector(".col.kactive")?.getAttribute("data-col");

    /** Open the first column's document, then take it full screen. */
    async function focusFromFirst(): Promise<HTMLElement> {
      const { container } = await withRows();
      fireEvent.click(screen.getByRole("button", { name: /note: First note/ }));
      await waitFor(() => {
        expect(container.querySelector(".reader")).not.toBeNull();
      });
      expect(activeColumn(container)).toBe("doc_one");
      fireEvent.keyDown(document, { key: "f" });
      await waitFor(() => {
        expect(document.querySelector(".focus.open")).not.toBeNull();
      });
      return container;
    }

    /**
     * The `mouseover` an unmounting overlay produces under a cursor that never
     * moved — `Column`'s handler is `onMouseOver`, which fires on re-entry and
     * on every move between descendants, and no `mousemove` accompanies it.
     */
    function restingPointerOver(container: HTMLElement, columnId: string): void {
      fireEvent.mouseOver(container.querySelector(`.col[data-col="${columnId}"]`) as Element);
    }

    it.each([
      ["esc", (): void => void fireEvent.keyDown(document, { key: "Escape" })],
      ["⌫", (): void => void fireEvent.keyDown(document, { key: "Backspace" })],
      [
        "the ✕ button",
        (): void =>
          void fireEvent.click(document.querySelector("[data-close-focus]") as HTMLElement),
      ],
      ["the f toggle", (): void => void fireEvent.keyDown(document, { key: "f" })],
    ])("keeps the origin column active when %s closes it", async (_name, close) => {
      const container = await focusFromFirst();

      close();
      await waitFor(() => {
        expect(document.querySelector(".focus.open")).toBeNull();
      });
      restingPointerOver(container, "doc_two");

      expect(activeColumn(container)).toBe("doc_one");
    });

    /**
     * The fourth close: the document under the excursion goes away, the focus
     * stack empties, and `FocusMode` closes itself. Nothing about it is a
     * keystroke, which is exactly why it has to arm the latch too.
     */
    it("keeps it through the depth-0 auto-close, when the document itself goes", async () => {
      const container = await focusFromFirst();

      fireEvent.click(document.querySelector(".focus [data-doc-menu]") as HTMLElement);
      fireEvent.click(screen.getByText(DELETE_LABEL));
      fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));
      await waitFor(() => {
        expect(document.querySelector(".focus.open")).toBeNull();
      });
      restingPointerOver(container, "doc_two");

      expect(activeColumn(container)).toBe("doc_one");
    });

    /** The half that makes it a latch and not a behaviour change. */
    it("resumes hover-follows-active on the first real movement, with no second move", async () => {
      const container = await focusFromFirst();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => {
        expect(document.querySelector(".focus.open")).toBeNull();
      });
      restingPointerOver(container, "doc_two");
      expect(activeColumn(container)).toBe("doc_one");

      fireEvent.mouseMove(document);
      restingPointerOver(container, "doc_two");

      expect(activeColumn(container)).toBe("doc_two");
    });

    /** The user-visible symptom: `esc` presses that did nothing at all. */
    it("leaves esc working on the reader beneath", async () => {
      const container = await focusFromFirst();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => {
        expect(document.querySelector(".focus.open")).toBeNull();
      });
      restingPointerOver(container, "doc_two");
      expect(container.querySelector(".reader")).not.toBeNull();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(container.querySelector(".reader")).toBeNull();
      });
    });
  });

  it("r says so rather than doing nothing when the document has no threads", async () => {
    const { container } = await withRows();
    fireEvent.click(screen.getByRole("button", { name: /note: First note/ }));
    await waitFor(() => {
      expect(container.querySelector(".reader")).not.toBeNull();
    });
    fireEvent.keyDown(document, { key: "r" });
    await waitFor(() => {
      expect(screen.getByText(/No thread to reply to/)).toBeDefined();
    });
  });
});
