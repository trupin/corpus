/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { INDEX_KEY } from "./keys.js";
import { useIndexStatus } from "./useIndexStatus.js";

afterEach(cleanup);

const CAUGHT_UP = {
  indexed: 273,
  pending: 0,
  working: false,
  failed: 0,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: false,
  state: "current",
};

const DRAINING = {
  indexed: 41,
  pending: 27,
  working: false,
  failed: 2,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: true,
  state: "indexing",
  detail: "rebuilding the index — 41 of 68 chunks embedded",
};

function transport(bodies: readonly unknown[]): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(new URL(request.url).pathname);
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, calls };
}

describe("useIndexStatus", () => {
  it("reads the whole pill's data from one call", async () => {
    const wire = transport([CAUGHT_UP]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useIndexStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(CAUGHT_UP);
    });
    expect(wire.calls).toEqual(["/api/index/status"]);
  });

  /*
   * The key is the point. `["index"]` is what the embed worker names as a
   * backlog drains (SERVER-051), so the counts climb with no poller — and a hook
   * that cached one segment deeper would type-check, pass every other test here,
   * and then show a frozen `0/68` forever.
   */
  it("refetches on the ['index'] frame the embed worker emits, and never polls", async () => {
    const wire = transport([DRAINING, CAUGHT_UP]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useIndexStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(INDEX_KEY)).toEqual(DRAINING);
    });

    harness.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [INDEX_KEY] }));
    await waitFor(() => {
      expect(result.current.data).toEqual(CAUGHT_UP);
    });
    expect(wire.calls).toEqual(["/api/index/status", "/api/index/status"]);
  });

  // `detail` is the server's sentence and survives the round trip untouched:
  // nothing between the wire and the console may parse, trim or reword it.
  it("carries the server's detail sentence through verbatim", async () => {
    const wire = transport([DRAINING]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useIndexStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data?.detail).toBe("rebuilding the index — 41 of 68 chunks embedded");
    });
  });
});
