/** @vitest-environment jsdom */
import type { ReflectStatus } from "@corpus/contract";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY, REFLECT_KEY } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAskReflection, useReflectStatus } from "./useReflectStatus";

afterEach(cleanup);

const STATUS: ReflectStatus = {
  reflected: "2026-08-22T09:00:00.000Z",
  pending: null,
  changed: 3,
  lastDigest: "th_digest",
  quiet: 30,
};

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: { method: string; path: string }[];
}

function transport(status: ReflectStatus = STATUS): Wire {
  const calls: { method: string; path: string }[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, path: url.pathname });
    const body =
      request.method === "POST"
        ? { eventId: "evt_1", since: status.reflected, pending: status.pending !== null }
        : status;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        // §7: the ask is a `202` whether or not it enqueued anything.
        status: request.method === "POST" ? 202 : 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, calls };
}

describe("useReflectStatus", () => {
  it("reads the clock, the count, the digest and the window in one call", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useReflectStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(STATUS);
    });
    expect(wire.calls).toEqual([{ method: "GET", path: "/api/workspace/reflect" }]);
  });

  /**
   * The key is the whole mechanism. SERVER-137 names `["reflect"]` on **every**
   * frame that names `["docs"]` or `["queue"]`, so one subscription covers both
   * halves of the control — a document write moving the count, and a queue
   * transition moving the pending state. A query cached under any other key
   * would type-check, pass every other test here, and serve a stale clock
   * forever.
   */
  it("caches under the key the server invalidates", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    renderHook(() => useReflectStatus(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(REFLECT_KEY)).toEqual(STATUS);
    });

    harness.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [REFLECT_KEY] }));
    await waitFor(() => {
      expect(wire.calls).toHaveLength(2);
    });
  });

  /** No poller: §7's clock moves on events, and asking again on a timer is guessing. */
  it("polls nothing", async () => {
    vi.useFakeTimers();
    try {
      const wire = transport();
      const harness = createCorpusTestHarness({ fetch: wire.fetch });
      renderHook(() => useReflectStatus(), { wrapper: harness.Wrapper });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(wire.calls.filter((call) => call.method === "GET")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useAskReflection", () => {
  it("posts the ask and refetches the clock", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useAskReflection(), { wrapper: harness.Wrapper });

    result.current.mutate();
    await waitFor(() => {
      expect(result.current.data?.eventId).toBe("evt_1");
    });
    expect(wire.calls).toContainEqual({ method: "POST", path: "/api/workspace/reflect" });
  });

  /**
   * §7: "an ask while one is pending is answered with the pending one, never
   * doubled". The route answers `202` with `pending: true` — a **success**, so
   * nothing here has an error to render.
   */
  it("treats an already-pending answer as a success", async () => {
    const wire = transport({ ...STATUS, pending: "evt_running" });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useAskReflection(), { wrapper: harness.Wrapper });

    result.current.mutate();
    await waitFor(() => {
      expect(result.current.data?.pending).toBe(true);
    });
    expect(result.current.error).toBeNull();
  });

  /**
   * An ask is a queue transition: it writes an event, so the console's list and
   * the queue's depth go stale with the clock. The server announces all three,
   * and naming them here is what flips the control on the press.
   */
  it("invalidates the clock, the queue and the jobs — and not the document collection", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const spy = vi.spyOn(harness.queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAskReflection(), { wrapper: harness.Wrapper });

    result.current.mutate();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(REFLECT_KEY));
    expect(keys).toContain(JSON.stringify(QUEUE_KEY));
    expect(keys).toContain(JSON.stringify(JOBS_KEY));
    // Nothing was written to a document, so nothing re-reads every column.
    expect(keys).not.toContain(JSON.stringify(DOCS_KEY));
  });
});
