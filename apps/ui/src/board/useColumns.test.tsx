/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport, viewRow } from "../testing/boardFixture";
import { useColumns } from "./useColumns";

afterEach(cleanup);

describe("useColumns", () => {
  it("asks for the whole column set in one bounded request", async () => {
    const wire = boardTransport({
      views: [
        viewRow({ id: "doc_1", title: "One", order: 10, query: { folder: "inbox" } }),
        viewRow({ id: "doc_2", title: "Two", order: 20, query: { type: "thread" } }),
        viewRow({ id: "doc_3", title: "Three", order: 30 }),
      ],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.columns).toHaveLength(3);
    });

    const reads = wire.calls.filter((call) => call.path === "/api/docs");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.search).toContain("pinned=true");
    expect(reads[0]?.search).toContain("type=view");
    expect(reads[0]?.search).toContain("sort=order");
    // Three columns and no per-column follow-up read: the N+1 this shape exists
    // to prevent.
    expect(wire.calls.filter((call) => call.path.startsWith("/api/docs/"))).toHaveLength(0);
  });

  it("orders columns by the documented tiebreak, not by arrival order", async () => {
    const wire = boardTransport({
      views: [
        viewRow({ id: "doc_z", title: "Zulu", order: null }),
        viewRow({ id: "doc_b", title: "Beta", order: 20 }),
        viewRow({ id: "doc_a", title: "Alpha", order: 20 }),
        viewRow({ id: "doc_c", title: "Gamma", order: 10 }),
      ],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.columns).toHaveLength(4);
    });
    expect(result.current.columns.map((column) => column.id)).toEqual([
      "doc_c",
      "doc_a",
      "doc_b",
      "doc_z",
    ]);
  });

  it("has no columns before the corpus answers, and says so honestly", async () => {
    const wire = boardTransport({ views: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumns(), { wrapper: harness.Wrapper });

    expect(result.current.columns).toEqual([]);
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.columns).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failed column-set read rather than pretending the board is empty", async () => {
    const failing = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { result } = renderHook(() => useColumns(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.columns).toEqual([]);
  });
});
