/** @vitest-environment jsdom */
import { DOCS_KEY } from "@corpus/contract/client";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { docCostKey } from "./keys.js";
import { useDocCost } from "./useDocCost.js";

afterEach(cleanup);

const SERIES = {
  granularity: "day",
  buckets: [
    {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-02T00:00:00.000Z",
      wroteTokens: 10,
      readTokens: 100,
      invocations: 3,
      byCommand: { "doc show": 110 },
    },
  ],
  total: 1,
  truncated: false,
  sizeBytes: 4000,
  measuringSince: "2026-08-28T00:00:00.000Z",
};

function routedFetch(): { readonly fetch: typeof globalThis.fetch; readonly urls: string[] } {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const request = new Request(input);
    urls.push(new URL(request.url).pathname);
    return Promise.resolve(
      new Response(JSON.stringify(SERIES), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, urls };
}

describe("useDocCost", () => {
  it("reads the document's series and returns it unchanged", async () => {
    const routed = routedFetch();
    const harness = createCorpusTestHarness({ fetch: routed.fetch });
    const { result } = renderHook(() => useDocCost("doc_a"), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(routed.urls).toEqual(["/api/docs/doc_a/cost"]);
    // Nothing derived: `truncated` and `measuringSince` are the server's claims
    // and arrive as they were sent.
    expect(result.current.data).toEqual(SERIES);
  });

  it("makes no request at all without a document", async () => {
    const routed = routedFetch();
    const harness = createCorpusTestHarness({ fetch: routed.fetch });
    const { result } = renderHook(() => useDocCost(undefined), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });
    expect(routed.urls).toEqual([]);
  });

  /**
   * The key hangs under the `["docs"]` prefix the server already names, which is
   * the only thing that refreshes this entry: telemetry announces nothing of its
   * own (sprint-025 R8), so a key outside that prefix would cache forever.
   */
  it("caches under the docs prefix, distinct from the reader's own entry", () => {
    expect(docCostKey("doc_a")).toEqual([...DOCS_KEY, "doc_a", "cost"]);
    // A thread is a document, so a `th_*` id is legal here.
    expect(docCostKey("th_a")).toEqual([...DOCS_KEY, "th_a", "cost"]);
  });
});
