/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { docKey, QUEUE_KEY, threadKey } from "./keys.js";
import { useCreateThread } from "./useCreateThread.js";

afterEach(cleanup);

const THREAD = {
  id: "th_new",
  title: "Stale review",
  created: "2026-07-27T12:00:00.000Z",
  updated: "2026-07-27T12:00:00.000Z",
  status: "open",
  tags: [],
  parent: "doc_a",
  anchor: null,
  agent: "requested",
  resident: null,
  turns: [],
};

function transport(eventId: string | null): {
  readonly fetch: typeof globalThis.fetch;
  readonly bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    bodies.push(JSON.parse(await request.text()) as unknown);
    return new Response(JSON.stringify({ thread: THREAD, anchorId: null, eventId, warnings: [] }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch, bodies };
}

describe("useCreateThread", () => {
  it("POSTs the thread and invalidates the new thread, its parent and the queue", async () => {
    const wire = transport("evt_1");
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(threadKey("th_new"), { id: "th_new" });
    harness.queryClient.setQueryData(docKey("doc_a"), { frontmatter: {} });
    harness.queryClient.setQueryData(QUEUE_KEY, { pending: 0 });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({
      parent: "doc_a",
      selector: null,
      body: "Review this",
      requestsAgent: true,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.bodies).toEqual([
      { parent: "doc_a", selector: null, body: "Review this", requestsAgent: true },
    ]);
    expect(harness.queryClient.getQueryState(threadKey("th_new"))?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(docKey("doc_a"))?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(QUEUE_KEY)?.isInvalidated).toBe(true);
  });

  it("leaves the queue alone when nothing was enqueued", async () => {
    const wire = transport(null);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(QUEUE_KEY, { pending: 0 });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({ body: "note only", requestsAgent: false });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(harness.queryClient.getQueryState(QUEUE_KEY)?.isInvalidated).toBe(false);
  });

  it("has no parent to invalidate for a standalone thread", async () => {
    const wire = transport(null);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({ parent: null, body: "standalone" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.bodies).toEqual([{ parent: null, body: "standalone" }]);
  });
});
