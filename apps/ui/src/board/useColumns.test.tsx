/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport, viewRow } from "../testing/boardFixture";
import { useColumns } from "./useColumns";

afterEach(cleanup);

const VIEWS = [
  viewRow({ id: "doc_1", title: "One", query: { folder: "inbox" } }),
  viewRow({ id: "doc_2", title: "Two", query: { type: "thread" } }),
  viewRow({ id: "doc_3", title: "Three" }),
];

describe("useColumns", () => {
  it("asks for every view document in one bounded request", async () => {
    const wire = boardTransport({ views: VIEWS });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(["doc_1", "doc_2", "doc_3"]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.columns).toHaveLength(3);
    });

    const reads = wire.calls.filter((call) => call.path === "/api/docs");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.search).toContain("type=view");
    // `pinned` left the API with rider 2: what puts a view on a board is the
    // board's own list, so the column query no longer filters on it.
    expect(reads[0]?.search).not.toContain("pinned");
    // Three columns and no per-column follow-up read: the N+1 this shape exists
    // to prevent.
    expect(wire.calls.filter((call) => call.path.startsWith("/api/docs/"))).toHaveLength(0);
  });

  /** The board document decides the order — not the view's own frontmatter. */
  it("renders the columns in the board's order", async () => {
    const wire = boardTransport({ views: VIEWS });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(["doc_3", "doc_1", "doc_2"]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.columns.every((column) => !column.missing)).toBe(true);
    });
    expect(result.current.columns.map((column) => column.viewId)).toEqual([
      "doc_3",
      "doc_1",
      "doc_2",
    ]);
    expect(result.current.columns.map((column) => column.title)).toEqual(["Three", "One", "Two"]);
  });

  /**
   * UI-148's second edge case: "a board whose `columns` lists the same view
   * twice: render it twice (the file says so), no dedupe". Both copies are the
   * same view document and separate **places** on the board, which is what the
   * distinct slot id is for.
   */
  it("renders a view the board lists twice as two columns with distinct slots", async () => {
    const wire = boardTransport({ views: VIEWS });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(["doc_1", "doc_2", "doc_1"]), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.columns.every((column) => !column.missing)).toBe(true);
    });
    expect(result.current.columns.map((column) => column.viewId)).toEqual([
      "doc_1",
      "doc_2",
      "doc_1",
    ]);
    expect(result.current.columns.map((column) => column.id)).toEqual([
      "doc_1",
      "doc_2",
      "doc_1#1",
    ]);
  });

  /**
   * "An id that resolves to nothing renders an error column card naming the id
   * (the §10 error card pattern), never a crash."
   */
  it("renders a column the board lists and the corpus cannot answer for", async () => {
    const wire = boardTransport({ views: VIEWS });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(["doc_1", "doc_gone"]), {
      wrapper: harness.Wrapper,
    });

    // The slots exist from the first render — one per id the board lists — so
    // the wait is for the *resolution*, not for the count.
    await waitFor(() => {
      expect(result.current.columns[0]?.missing).toBe(false);
    });
    const missing = result.current.columns[1];
    expect(missing?.missing).toBe(true);
    expect(missing?.viewId).toBe("doc_gone");
    // The id is the only thing known about it, so the id is what the card names.
    expect(missing?.title).toBe("doc_gone");
    expect(missing?.error).toContain("no `type: view` document");
    // …and the column that does resolve is untouched by its neighbour's defect.
    expect(result.current.columns[0]?.title).toBe("One");
  });

  it("has no columns before the corpus answers, and says so honestly", async () => {
    const wire = boardTransport({ views: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns([]), { wrapper: harness.Wrapper });

    expect(result.current.columns).toEqual([]);
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.columns).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  /** No board at all — the third edge case. Nothing to resolve, so nothing is asked. */
  it("resolves nothing when no board is showing", async () => {
    const wire = boardTransport({ views: VIEWS });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(null), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.columns).toEqual([]);
  });

  it("surfaces a failed view read rather than pretending the board is empty", async () => {
    const failing = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { result } = renderHook(() => useColumns(["doc_1"]), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    // A read that failed is not the same as a board that lists nothing: every id
    // resolves to nothing, so each renders its own error card rather than
    // silently disappearing.
    expect(result.current.columns).toHaveLength(1);
    expect(result.current.columns[0]?.missing).toBe(true);
  });
});
