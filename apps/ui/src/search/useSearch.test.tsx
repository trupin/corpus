/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "./searchQuery";
import { hitFixture, searchTransport, type SearchTransportOptions } from "./searchTransport";
import { useSearch } from "./useSearch";

afterEach(cleanup);

const DEBOUNCE = 60;

const HITS = [
  hitFixture({
    id: "doc_mortgage",
    title: "Mortgage options",
    headingPath: "Mortgage options › Rate assumptions",
    snippet: "the base case assumes a 30-year fixed",
  }),
];

function setup(initial: SearchQuery = EMPTY_SEARCH_QUERY, options: SearchTransportOptions = {}) {
  const wire = searchTransport({ hits: HITS, ...options });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const view = renderHook(({ query }: { query: SearchQuery }) => useSearch(query, DEBOUNCE), {
    initialProps: { query: initial },
    wrapper: harness.Wrapper,
  });
  return { ...view, searches: wire.searches, wire };
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const typed = (text: string): SearchQuery => ({ ...EMPTY_SEARCH_QUERY, text });

describe("useSearch", () => {
  it("asks nothing at all until something is typed — `q` is required", async () => {
    const { result, searches } = setup();
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(0);
    expect(result.current.isIdle).toBe(true);
    expect(result.current.hits).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("asks nothing for chips alone — a filter set is not a ranking", async () => {
    const { rerender, searches } = setup();
    rerender({ query: { ...EMPTY_SEARCH_QUERY, folder: "finance", unread: true } });
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(0);
  });

  it("issues one request per debounce window, not one per keystroke", async () => {
    const { rerender, searches } = setup();

    for (const text of ["m", "mo", "mor", "mort", "mortgage"]) rerender({ query: typed(text) });

    await waitFor(() => {
      expect(searches().length).toBe(1);
    });
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(1);
    expect(searches()[0]?.path).toBe("/api/search");
    expect(new URLSearchParams(searches()[0]?.search).get("q")).toBe("mortgage");
  });

  it("carries every active chip on that one request, and no `sort`", async () => {
    const { rerender, searches } = setup();

    rerender({
      query: { ...EMPTY_SEARCH_QUERY, text: "mortgage", folder: "finance", unread: true },
    });

    await waitFor(() => {
      expect(searches().length).toBe(1);
    });
    const params = new URLSearchParams(searches()[0]?.search);
    expect(params.get("q")).toBe("mortgage");
    expect(params.get("folder")).toBe("finance");
    expect(params.get("unread")).toBe("true");
    expect(params.has("sort")).toBe(false);
    expect(params.has("offset")).toBe(false);
    expect(params.has("pinned")).toBe(false);
  });

  it("omits `status` entirely by default, leaving the server's archived rule to apply", async () => {
    const { rerender, searches } = setup();
    rerender({ query: typed("rates") });
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });
    const params = new URLSearchParams(searches()[0]?.search);
    expect(params.has("status")).toBe(false);
    expect(params.has("includeArchived")).toBe(false);
  });

  it("re-queries once when the archived chip is toggled", async () => {
    const { rerender, searches } = setup(typed("rates"));
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
    const query = typed("rates");
    const { rerender, searches } = setup(query);
    await waitFor(() => {
      expect(searches().length).toBe(1);
    });

    rerender({ query: { ...query } });
    await settle(DEBOUNCE * 3);
    expect(searches().length).toBe(1);
  });

  it("keeps the previous ranking on screen while the next one is in flight", async () => {
    const { rerender, result } = setup(typed("mort"));
    await waitFor(() => {
      expect(result.current.hits.length).toBe(1);
    });

    rerender({ query: typed("mortgage") });
    expect(result.current.isDebouncing).toBe(true);
    expect(result.current.hits.length).toBe(1);

    await waitFor(() => {
      expect(result.current.isDebouncing).toBe(false);
    });
    expect(result.current.hits.map((hit) => hit.id)).toEqual(["doc_mortgage"]);
  });

  it("drops the ranking when the query is cleared rather than showing a stale one", async () => {
    const { rerender, result } = setup(typed("mortgage"));
    await waitFor(() => {
      expect(result.current.hits.length).toBe(1);
    });

    rerender({ query: EMPTY_SEARCH_QUERY });
    await waitFor(() => {
      expect(result.current.isIdle).toBe(true);
    });
    expect(result.current.hits).toEqual([]);
  });

  it("carries the envelope's `semanticIndex` through untouched", async () => {
    const { result } = setup(typed("mortgage"), { semanticIndex: "stale" });
    await waitFor(() => {
      expect(result.current.semanticIndex).toBe("stale");
    });

    cleanup();
    const silent = setup(typed("mortgage"));
    await waitFor(() => {
      expect(silent.result.current.hits.length).toBe(1);
    });
    expect(silent.result.current.semanticIndex).toBeUndefined();
  });

  it("surfaces a refused query rather than rendering an empty search", async () => {
    const { result } = setup(typed("boom"), { searchFails: 400 });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toContain("no such filter");
  });
});
