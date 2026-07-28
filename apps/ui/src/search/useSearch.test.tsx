/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport, type RecordedCall } from "../testing/boardFixture";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "./searchQuery";
import { useSearch } from "./useSearch";

afterEach(cleanup);

const DEBOUNCE = 60;

const ROWS = [docRowFixture({ id: "doc_mortgage", title: "Mortgage options" })];

function setup(initial: SearchQuery = EMPTY_SEARCH_QUERY) {
  const wire = boardTransport({ defaultRows: ROWS });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const view = renderHook(({ query }: { query: SearchQuery }) => useSearch(query, DEBOUNCE), {
    initialProps: { query: initial },
    wrapper: harness.Wrapper,
  });
  const searches = (): RecordedCall[] =>
    wire.calls.filter((call) => call.method === "GET" && call.path === "/api/docs");
  return { ...view, searches, wire };
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("useSearch", () => {
  it("issues one request per debounce window, not one per keystroke", async () => {
    const { rerender, searches } = setup();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    for (const text of ["m", "mo", "mor", "mort", "mortgage"]) {
      rerender({ query: { ...EMPTY_SEARCH_QUERY, text } });
    }

    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    // And it stays at two: the four intermediate queries were never sent.
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(2);
    expect(searches()[1]?.search).toContain("q=mortgage");
  });

  it("carries every active chip on that one request", async () => {
    const { rerender, searches } = setup();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    rerender({
      query: { ...EMPTY_SEARCH_QUERY, text: "mortgage", folder: "finance", unread: true },
    });

    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    const params = new URLSearchParams(searches()[1]?.search);
    expect(params.get("q")).toBe("mortgage");
    expect(params.get("folder")).toBe("finance");
    expect(params.get("unread")).toBe("true");
    expect(params.get("sort")).toBe("relevance");
  });

  it("omits `status` entirely by default, leaving the server's archived rule to apply", async () => {
    const { rerender, searches } = setup();
    rerender({ query: { ...EMPTY_SEARCH_QUERY, text: "rates" } });
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    const params = new URLSearchParams(searches()[1]?.search);
    expect(params.has("status")).toBe(false);
    expect(params.has("includeArchived")).toBe(false);
  });

  it("re-queries once when the archived chip is toggled", async () => {
    const { rerender, searches } = setup();
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    rerender({ query: { ...EMPTY_SEARCH_QUERY, text: "rates", includeArchived: true } });
    await waitFor(() => {
      expect(searches().length).toBe(2);
    });
    expect(new URLSearchParams(searches()[1]?.search).get("includeArchived")).toBe("true");
  });

  it("re-renders with an unchanged query without issuing anything", async () => {
    const query: SearchQuery = { ...EMPTY_SEARCH_QUERY, text: "rates" };
    const { rerender, searches } = setup(query);
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    // A different object, the same search — the cache key is value-based.
    rerender({ query: { ...query } });
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(1);
  });

  it("keeps the previous result set on screen while the next one is in flight", async () => {
    const { rerender, result } = setup();
    await waitFor(() => {
      expect(result.current.items.length).toBe(1);
    });

    rerender({ query: { ...EMPTY_SEARCH_QUERY, text: "mortgage" } });
    expect(result.current.isDebouncing).toBe(true);
    // Never blanks: the rows shown are always a set the server returned.
    expect(result.current.items.length).toBe(1);

    await waitFor(() => {
      expect(result.current.isDebouncing).toBe(false);
    });
    expect(result.current.items.map((row) => row.id)).toEqual(["doc_mortgage"]);
  });

  it("surfaces a refused query rather than rendering an empty search", async () => {
    const wire = boardTransport({ failing: { "/api/docs?q=boom&sort=relevance": 400 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(
      () => useSearch({ ...EMPTY_SEARCH_QUERY, text: "boom" }, DEBOUNCE),
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toContain("no such filter");
  });
});
