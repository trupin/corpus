/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { relatedKey, searchKey } from "./keys.js";
import { useCorpusSearch } from "./useCorpusSearch.js";
import { useRelatedDocs } from "./useRelatedDocs.js";

/**
 * The two ranked-retrieval hooks (SPEC.md §9.2), asserted at the seam that
 * matters: the route each one calls, the key it caches under, and — the whole
 * point of sprint-022 Open Conflict 7 — that an `invalidate` frame the server
 * *already* emits refetches them.
 *
 * `keys.ts` states the failure mode this file exists to catch: a client that
 * caches under a key no frame ever names "type-checks perfectly, passes every
 * unit test, and then serves stale data forever". A key assertion alone would
 * not catch it; a dispatched frame does.
 */

const RELATED = {
  related: [
    { id: "doc_b", title: "Rates", excerpt: "6.4% this week.", relation: "linked" },
    { id: "doc_c", title: "Offers", excerpt: "Two lenders.", relation: "similar" },
  ],
  semanticIndex: "current",
};

const HITS = {
  hits: [{ id: "doc_b", title: "Rates", headingPath: "Rates › Q3", snippet: "6.4% this week." }],
  semanticIndex: "current",
};

function routedFetch(): { readonly fetch: typeof globalThis.fetch; readonly urls: string[] } {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const request = new Request(input);
    const url = new URL(request.url);
    urls.push(url.pathname + url.search);
    return Promise.resolve(
      new Response(JSON.stringify(url.pathname === "/api/search" ? HITS : RELATED), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch: fetch, urls };
}

afterEach(cleanup);

describe("useRelatedDocs", () => {
  it("reads GET /api/docs/{id}/related and caches under `[docs, id, related]`", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useRelatedDocs("doc_a"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(transport.urls).toEqual(["/api/docs/doc_a/related"]);
    expect(harness.queryClient.getQueryData(relatedKey("doc_a"))).toBeDefined();
  });

  // TEST-1012: the hook hands the rows over exactly as the server ranked and
  // labelled them. No re-sort, no phase logic, no filtering of `similar`.
  it("returns the server's rows in the server's order, relations intact", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useRelatedDocs("doc_a"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.related.map((row) => [row.id, row.relation])).toEqual([
      ["doc_b", "linked"],
      ["doc_c", "similar"],
    ]);
  });

  // TEST-1017: a host with no open document issues no request.
  it("issues no request without a document", () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(() => useRelatedDocs(undefined), { wrapper: harness.Wrapper });
    expect(transport.urls).toEqual([]);
  });

  it("issues no request for an empty id", () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(() => useRelatedDocs(""), { wrapper: harness.Wrapper });
    expect(transport.urls).toEqual([]);
  });
});

describe("useCorpusSearch", () => {
  it("reads GET /api/search and caches under the search key", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCorpusSearch({ q: "budget" }), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(transport.urls).toEqual(["/api/search?q=budget"]);
    expect(harness.queryClient.getQueryData(searchKey({ q: "budget" }))).toBeDefined();
  });

  it("shares one cache entry and one request across two spellings of one query", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(
      () => {
        useCorpusSearch({ q: "budget", tag: ["b", "a"] });
        useCorpusSearch({ q: "budget", tag: ["a", "b"], type: undefined });
      },
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(transport.urls).toHaveLength(1);
    });
    expect(
      harness.queryClient.getQueryCache().findAll({ queryKey: ["docs", "search"] }),
    ).toHaveLength(1);
  });

  // `q` is required by the contract and an empty one is a 400: an open overlay
  // with nothing typed in it is not a ranking of everything.
  it.each([undefined, { q: "" }, { q: "   " }])("issues no request for %o", (params) => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(() => useCorpusSearch(params), { wrapper: harness.Wrapper });
    expect(transport.urls).toEqual([]);
  });
});

/**
 * TEST-1010 / TEST-1044. Open Conflict 7's ruling, proven behaviourally rather
 * than by inspecting a key: the server emits `["docs"]` on every document and
 * thread mutation and every watcher-projected change, and that frame — with no
 * tenth name in the contract's closed vocabulary — has to reach both queries.
 */
describe("the frames the server already sends", () => {
  it("refetches a related set on a bare `docs` frame", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch, batchWindowMs: 0 });
    const { result } = renderHook(() => useRelatedDocs("doc_a"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(transport.urls).toHaveLength(1);

    harness.eventSource.latest().invalidate(["docs"]);

    await waitFor(() => {
      expect(transport.urls).toHaveLength(2);
    });
    expect(transport.urls[1]).toBe("/api/docs/doc_a/related");
  });

  it("refetches a related set on that document's own frame", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch, batchWindowMs: 0 });
    const { result } = renderHook(() => useRelatedDocs("doc_a"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // `["docs", "doc_a"]` is a prefix of `["docs", "doc_a", "related"]`, which is
    // why the key was hung under the document rather than beside it.
    harness.eventSource.latest().invalidate(["docs", "doc_a"]);

    await waitFor(() => {
      expect(transport.urls).toHaveLength(2);
    });
  });

  it("leaves a related set alone on a frame naming another shape", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch, batchWindowMs: 0 });
    const { result } = renderHook(() => useRelatedDocs("doc_a"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    harness.eventSource.latest().invalidate(["tree"], ["locks"], ["docs", "doc_other"]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(transport.urls).toHaveLength(1);
  });

  it("refetches a ranked search on a bare `docs` frame", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch, batchWindowMs: 0 });
    const { result } = renderHook(() => useCorpusSearch({ q: "budget" }), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(transport.urls).toHaveLength(1);

    harness.eventSource.latest().invalidate(["docs"]);

    await waitFor(() => {
      expect(transport.urls).toHaveLength(2);
    });
  });
});
