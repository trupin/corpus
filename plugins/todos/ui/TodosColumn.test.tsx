/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupOpenItems, TodosColumn } from "./TodosColumn.js";
import { TS, transport, wrapperFor, type Transport } from "./testing.js";

afterEach(cleanup);

const NOW = new Date("2026-07-20T12:00:00.000Z");

const item = (text: string, done: boolean, due?: string): Record<string, unknown> => ({
  text,
  done,
  ts: TS,
  ...(due === undefined ? {} : { due }),
});

const listRow = (id: string, title: string, items: unknown): DocRow =>
  docRowFixture({ id, type: "todo", title, extra: { items } });

interface Mounted {
  readonly wire: Transport;
  readonly onOpen: ReturnType<typeof vi.fn>;
}

function mount(docs: readonly DocRow[]): Mounted {
  const wire = transport({ docs });
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

describe("groupOpenItems", () => {
  it("keeps only open items and drops documents with none", () => {
    const grouped = groupOpenItems([
      listRow("doc_a", "A", [item("open", false), item("done", true)]),
      listRow("doc_b", "B", [item("all done", true)]),
      listRow("doc_c", "C", []),
    ]);
    expect(grouped).toEqual([
      { docId: "doc_a", title: "A", items: [{ text: "open", done: false, ts: TS }] },
    ]);
  });

  it("degrades a document with malformed items to none rather than throwing", () => {
    expect(groupOpenItems([listRow("doc_bad", "Bad", "nope")])).toEqual([]);
  });
});

describe("TodosColumn", () => {
  it("aggregates open items across documents, grouped by their list", async () => {
    mount([
      listRow("doc_week", "Week of Jul 20", [item("Renew passport", false), item("Sent", true)]),
      listRow("doc_house", "House paperwork", [item("Pull credit reports", false)]),
    ]);
    await waitFor(() => {
      expect(groups()).toEqual(["doc_week", "doc_house"]);
    });
    expect(itemTexts()).toEqual(["Renew passport", "Pull credit reports"]);
    // Done items never appear: the column is what is still to do.
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.getByText("Week of Jul 20")).toBeTruthy();
  });

  it("issues exactly one docs query — items ride the list rows", async () => {
    const { wire } = mount([listRow("doc_week", "Week", [item("a", false)])]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    const docsCalls = wire.calls.filter((call) => new URL(call.url).pathname === "/api/docs");
    expect(docsCalls).toHaveLength(1);
    expect(docsCalls[0]?.url).toContain("type=todo");
    // No per-document follow-up read, and no bespoke plugin endpoint.
    expect(wire.calls.some((call) => new URL(call.url).pathname.startsWith("/api/docs/"))).toBe(
      false,
    );
    expect(wire.pluginCalls()).toEqual([]);
  });

  /**
   * The server's default result set already excludes `status: archived`
   * (SPEC.md §11) and the column states no `status`, so it inherits core's
   * answer instead of inventing a second one — asserted here as the query it
   * actually sends.
   */
  it("names no status, so archived documents are excluded by core's default", async () => {
    const { wire } = mount([listRow("doc_week", "Week", [item("a", false)])]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    const url = wire.calls.find((call) => new URL(call.url).pathname === "/api/docs")?.url ?? "";
    expect(url).not.toContain("status=");
    expect(url).not.toContain("includeArchived");
  });

  it("opens the source document from a group heading and from any item row", async () => {
    const { onOpen } = mount([listRow("doc_week", "Week", [item("a", false)])]);
    await waitFor(() => {
      expect(groups()).toHaveLength(1);
    });
    fireEvent.click(screen.getByText("Week"));
    fireEvent.click(screen.getByText("a"));
    expect(onOpen.mock.calls).toEqual([["doc_week"], ["doc_week"]]);
  });

  it("survives a host that wired no open callback", async () => {
    render(<TodosColumn viewDocId="doc_col" title="Todos" query={{}} now={NOW} />, {
      wrapper: wrapperFor(transport({ docs: [listRow("doc_week", "Week", [item("a", false)])] }))
        .Wrapper,
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
    const { onOpen } = mount([listRow("doc_week", "Week", many)]);
    await waitFor(() => {
      expect(itemTexts()).toHaveLength(5);
    });
    fireEvent.click(screen.getByText("+3 more"));
    expect(onOpen).toHaveBeenCalledWith("doc_week");
    // The group heading still counts the whole list.
    expect(document.querySelector(".todos-group-count")?.textContent).toBe("8");
  });

  it("marks an overdue item", async () => {
    mount([listRow("doc_week", "Week", [item("late", false, "2026-07-10")])]);
    await waitFor(() => {
      expect(document.querySelector(".todos-column .check")?.className).toContain("overdue");
    });
    expect(document.querySelector(".todos-column .due")?.getAttribute("data-overdue")).toBe("true");
  });

  it("shows an empty state when nothing is open", async () => {
    mount([listRow("doc_week", "Week", [item("done", true)])]);
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
});
