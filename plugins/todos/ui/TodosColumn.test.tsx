/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupItems, TodosColumn } from "./TodosColumn.js";
import { listPayload, memoryStorage, transport, wrapperFor, type Transport } from "./testing.js";

beforeEach(() => {
  // The show-completed control is browser-local (PLUGINS-015): a dependable
  // store per test, because the ambient one is not (see `testing.tsx`).
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-07-20T12:00:00.000Z");

const item = (
  text: string,
  done: boolean,
  due?: string,
): { text: string; done: boolean; due?: string } => ({
  text,
  done,
  ...(due === undefined ? {} : { due }),
});

/**
 * A todo document as the board sees it since PLUGINS-005: a **row** carrying no
 * items (its body does not ride the list), plus the aggregate entry the
 * plugin's own `GET /lists` route answers with. The pair is what every test
 * here mounts, because it is what production looks like.
 */
const listRow = (id: string, title: string): DocRow =>
  docRowFixture({ id, type: "todo", title, excerpt: "a todo document" });

interface Mounted {
  readonly wire: Transport;
  readonly onOpen: ReturnType<typeof vi.fn>;
}

type Entry = readonly [string, string, readonly { text: string; done: boolean; due?: string }[]];

function mount(entries: readonly Entry[]): Mounted {
  const wire = transport({
    docs: entries.map(([id, title]) => listRow(id, title)),
    lists: entries.map(([id, title, items]) => listPayload(id, title, items)),
  });
  const onOpen = vi.fn();
  render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} onOpen={onOpen} now={NOW} />, {
    wrapper: wrapperFor(wire).Wrapper,
  });
  return { wire, onOpen };
}

const groups = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-todos-group]")].map(
    (node) => node.dataset["todosGroup"] ?? "",
  );

const itemTexts = (): string[] =>
  [...document.querySelectorAll(".todos-column .todo-item-text")].map(
    (node) => node.textContent ?? "",
  );

describe("groupItems", () => {
  const list = (
    docId: string,
    title: string,
    items: readonly { text: string; done: boolean }[],
  ): Parameters<typeof groupItems>[0][number] => ({
    docId,
    title,
    open: items.filter((entry) => !entry.done).length,
    done: items.filter((entry) => entry.done).length,
    items: [...items],
  });

  it("keeps only open items and drops documents with none", () => {
    const grouped = groupItems(
      [
        list("doc_a", "A", [item("open", false), item("done", true)]),
        list("doc_b", "B", [item("all done", true)]),
        list("doc_c", "C", []),
      ],
      false,
    );
    expect(grouped).toEqual([
      {
        docId: "doc_a",
        title: "A",
        // Every item, done ones included: a reveal's frame quotes the lines the
        // reader renders, and a checked item is one of them (PLUGINS-010).
        all: [
          { text: "open", done: false },
          { text: "done", done: true },
        ],
        items: [{ at: 0, item: { text: "open", done: false } }],
      },
    ]);
  });

  /**
   * The rider's control (SPEC.md §12, signed 2026-08-12): a list whose every
   * item is done is dropped when only open items are shown, and comes back —
   * with its checked items, so they can be unchecked — when they are asked for.
   */
  it("keeps completed items, and the lists made only of them, when asked", () => {
    const grouped = groupItems(
      [
        list("doc_a", "A", [item("open", false), item("done", true)]),
        list("doc_b", "B", [item("all done", true)]),
        list("doc_c", "C", []),
      ],
      true,
    );
    expect(grouped.map((group) => group.docId)).toEqual(["doc_a", "doc_b"]);
    expect(grouped[0]?.items).toEqual([
      { at: 0, item: { text: "open", done: false } },
      { at: 1, item: { text: "done", done: true } },
    ]);
    expect(grouped[1]?.items).toEqual([{ at: 0, item: { text: "all done", done: true } }]);
  });

  /** The position is the item's place in the **document**, not in the column. */
  it("records each open item's position among all of the document's items", () => {
    const grouped = groupItems(
      [list("doc_a", "A", [item("done", true), item("first", false), item("second", false)])],
      false,
    );
    expect(grouped[0]?.items).toEqual([
      { at: 1, item: { text: "first", done: false } },
      { at: 2, item: { text: "second", done: false } },
    ]);
  });

  it("answers nothing for a workspace with no todo documents at all", () => {
    expect(groupItems([], false)).toEqual([]);
    expect(groupItems([], true)).toEqual([]);
  });
});

describe("TodosColumn", () => {
  it("aggregates open items across documents, grouped by their list", async () => {
    mount([
      ["doc_week", "Week of Jul 20", [item("Renew passport", false), item("Sent", true)]],
      ["doc_house", "House paperwork", [item("Pull credit reports", false)]],
    ]);
    await waitFor(() => {
      expect(groups()).toEqual(["doc_week", "doc_house"]);
    });
    expect(itemTexts()).toEqual(["Renew passport", "Pull credit reports"]);
    // Done items never appear: the column is what is still to do.
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.getByText("Week of Jul 20")).toBeTruthy();
  });

  /**
   * TEST-512. Bodies do not ride list rows, so the items now come from the
   * plugin's own aggregate — but it is still **one** request for the whole
   * board, and still no per-document read.
   */
  it("issues one docs query and one aggregate request, never one per document", async () => {
    const { wire } = mount([
      ["doc_week", "Week", [item("a", false)]],
      ["doc_house", "House", [item("b", false)]],
      ["doc_car", "Car", [item("c", false)]],
    ]);
    await waitFor(() => {
      expect(groups()).toHaveLength(3);
    });
    const docsCalls = wire.calls.filter((call) => new URL(call.url).pathname === "/api/docs");
    expect(docsCalls).toHaveLength(1);
    expect(docsCalls[0]?.url).toContain("type=todo");
    expect(wire.pluginCalls()).toHaveLength(1);
    // No per-document follow-up read of any kind.
    expect(wire.calls.some((call) => new URL(call.url).pathname.startsWith("/api/docs/"))).toBe(
      false,
    );
  });

  /**
   * TEST-511, checked directly rather than inferred from the symptom: the
   * aggregate's path — and therefore the kit's query key — carries a
   * fingerprint of the rows' `(id, updated)`, and the key stays **prefixed** by
   * `x/todos/lists` so the plugin's own broadcast still invalidates it.
   */
  it("keys the aggregate on a fingerprint of the documents' (id, updated)", async () => {
    const { wire } = mount([["doc_week", "Week", [item("a", false)]]]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    const path = new URL(wire.pluginCalls()[0]?.url ?? "http://x/").pathname;
    expect(path).toMatch(/^\/api\/x\/todos\/lists\/at\/[a-z0-9]+$/);
  });

  /**
   * The server's default result set already excludes `status: archived`
   * (SPEC.md §11) and the column states no `status`, so it inherits core's
   * answer instead of inventing a second one — asserted here as the query it
   * actually sends.
   */
  it("names no status, so archived documents are excluded by core's default", async () => {
    const { wire } = mount([["doc_week", "Week", [item("a", false)]]]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    const url = wire.calls.find((call) => new URL(call.url).pathname === "/api/docs")?.url ?? "";
    expect(url).not.toContain("status=");
    expect(url).not.toContain("includeArchived");
  });

  /**
   * PLUGINS-010. The heading names a document and opens it at the top, exactly
   * as it always did; an item row names a **line**, and says so.
   */
  it("opens the document from a group heading and the clicked line from an item row", async () => {
    const { onOpen } = mount([
      ["doc_week", "Week", [item("a", false), item("b", false), item("c", false)]],
    ]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    fireEvent.click(screen.getByText("Week"));
    fireEvent.click(screen.getByText("b"));
    expect(onOpen.mock.calls).toEqual([
      ["doc_week"],
      [
        {
          docId: "doc_week",
          reveal: { kind: "item", exact: "b", prefix: "a", suffix: "c" },
        },
      ],
    ]);
  });

  /**
   * sprint-023 OC4, through the real click: the column shows two identical
   * lines, and clicking the second one must not point at the first. The frames
   * come from the document's own neighbours — including the **checked** item
   * the column does not display, because the reader does.
   */
  it("distinguishes duplicate items by the neighbours the reader will render", async () => {
    const { onOpen } = mount([
      [
        "doc_week",
        "Week",
        [
          item("Call the plumber", false),
          item("Sent the signed form", true),
          item("Call the plumber", false),
        ],
      ],
    ]);
    await waitFor(() => {
      expect(itemTexts()).toEqual(["Call the plumber", "Call the plumber"]);
    });
    const [firstRow, secondRow] = [
      ...document.querySelectorAll<HTMLElement>(".todos-column .check .todo-item-open"),
    ];
    if (firstRow === undefined || secondRow === undefined) throw new Error("expected two rows");
    fireEvent.click(secondRow);
    expect(onOpen).toHaveBeenCalledWith({
      docId: "doc_week",
      reveal: {
        kind: "item",
        exact: "Call the plumber",
        prefix: "Sent the signed form",
      },
    });
    fireEvent.click(firstRow);
    expect(onOpen).toHaveBeenLastCalledWith({
      docId: "doc_week",
      reveal: {
        kind: "item",
        exact: "Call the plumber",
        suffix: "Sent the signed form",
      },
    });
  });

  it("survives a host that wired no open callback", async () => {
    const wire = transport({
      docs: [listRow("doc_week", "Week")],
      lists: [listPayload("doc_week", "Week", [item("a", false)])],
    });
    render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} now={NOW} />, {
      wrapper: wrapperFor(wire).Wrapper,
    });
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    expect(() => {
      fireEvent.click(screen.getByText("a"));
    }).not.toThrow();
  });

  it("truncates a long list with a +N more affordance rather than a new endpoint", async () => {
    const many = Array.from({ length: 8 }, (_entry, index) => item(`item ${String(index)}`, false));
    const { onOpen } = mount([["doc_week", "Week", many]]);
    await waitFor(() => {
      expect(itemTexts()).toHaveLength(5);
    });
    fireEvent.click(screen.getByText("+3 more"));
    expect(onOpen).toHaveBeenCalledWith("doc_week");
    // The group heading still counts the whole list.
    expect(document.querySelector(".todos-group-count")?.textContent).toBe("8");
  });

  /** TEST-513: the overdue treatment, now driven by the parsed inline marker. */
  it("marks an overdue item and leaves a future deadline alone", async () => {
    mount([
      ["doc_week", "Week", [item("late", false, "2026-07-10"), item("soon", false, "2026-07-25")]],
    ]);
    await waitFor(() => {
      expect(document.querySelectorAll(".todos-column .check")).toHaveLength(2);
    });
    const checks = [...document.querySelectorAll(".todos-column .check")];
    expect(checks[0]?.className).toContain("overdue");
    expect(checks[1]?.className).not.toContain("overdue");
    expect(
      [...document.querySelectorAll(".todos-column .due")].map((node) =>
        node.getAttribute("data-overdue"),
      ),
    ).toEqual(["true", "false"]);
  });

  it("shows an empty state when nothing is open", async () => {
    mount([["doc_week", "Week", [item("done", true)]]]);
    await waitFor(() => {
      expect(screen.getByText(/Every todo list is clear/)).toBeTruthy();
    });
  });

  it("shows a loading state before the first response", () => {
    mount([]);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows an error card in place when the query fails", async () => {
    const wire = transport({});
    const failing: Transport = {
      ...wire,
      fetch: () => Promise.reject(new Error("the server hung up")),
    };
    render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} now={NOW} />, {
      wrapper: wrapperFor(failing).Wrapper,
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Todos could not be loaded");
    });
  });

  it("shows an error card when the aggregate answers a shape it cannot read", async () => {
    const wire = transport({
      docs: [listRow("doc_week", "Week")],
      lists: null,
      write: { status: 200, body: { lists: "not a list" } },
    });
    render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} now={NOW} />, {
      wrapper: wrapperFor(wire).Wrapper,
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("does not understand");
    });
  });
});
