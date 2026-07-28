/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { QUEUE_KEY } from "./keys.js";
import { useQueueStatus } from "./useQueueStatus.js";

afterEach(cleanup);

const STATUS = {
  halted: false,
  pending: 2,
  inProgress: 1,
  processed: 4,
  failed: 1,
  abandoned: 0,
};

function transport(): { readonly fetch: typeof globalThis.fetch; readonly calls: string[] } {
  const calls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(new URL(request.url).pathname);
    return Promise.resolve(
      new Response(JSON.stringify(STATUS), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, calls };
}

describe("useQueueStatus", () => {
  it("reads the whole strip's data from one call", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useQueueStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(STATUS);
    });
    expect(wire.calls).toEqual(["/api/queue/status"]);
  });

  // The key matters more than the value: `QUEUE_KEY` is exactly what the server
  // names on every queue transition, so a halt set from a terminal reaches the
  // strip without a poller.
  it("caches under the key the server invalidates", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    renderHook(() => useQueueStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(QUEUE_KEY)).toEqual(STATUS);
    });

    harness.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [QUEUE_KEY] }));
    await waitFor(() => {
      expect(wire.calls).toHaveLength(2);
    });
  });
});
