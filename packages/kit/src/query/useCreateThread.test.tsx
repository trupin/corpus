/** @vitest-environment jsdom */
import type { Thread } from "@corpus/contract";
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
  unread: false,
  turns: [],
} satisfies Thread;

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

/**
 * Records the `init` body **without** constructing a `Request` around it.
 *
 * This file runs in jsdom, so its `FormData` is jsdom's and `Request` is Node's
 * undici: wrapping one in the other is the realm split `threadWriteHooks.test`
 * documents, and it is what kills a multipart mutation on Node 22 while passing
 * on Node 25. The multipart helper hands `fetch` a `URL` plus an `init`, so the
 * body is right there to read.
 */
function multipartTransport(): {
  readonly fetch: typeof globalThis.fetch;
  readonly forms: FormData[];
} {
  const forms: FormData[] = [];
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body instanceof FormData) forms.push(init.body);
    return Promise.resolve(
      new Response(
        JSON.stringify({ thread: THREAD, anchorId: null, eventId: null, warnings: [] }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  });
  return { fetch, forms };
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

  /**
   * The hook's own branch, which is where CONTRACT-095 lost the field: attaching
   * a file switches the request and every field the JSON body carries has to
   * survive that switch. A file **and** an owner, because one without the other
   * is exactly what every test before this one sent.
   */
  it("carries the designation onto the multipart branch when a file is attached", async () => {
    const wire = multipartTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({
      parent: null,
      selector: null,
      body: "Take the forecast apart.",
      requestsAgent: true,
      resident: { name: "researcher", weight: "heavy" },
      files: [new File(["a"], "shot.png", { type: "image/png" })],
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const form = wire.forms[0];
    expect(form?.getAll("files")).toHaveLength(1);
    // Present before decoded, so a dropped part reads as the missing
    // designation it is rather than as a JSON parse error.
    const encoded = form?.get("resident");
    expect(typeof encoded).toBe("string");
    expect(JSON.parse(typeof encoded === "string" ? encoded : "")).toEqual({
      name: "researcher",
      weight: "heavy",
    });
  });

  /** `null` is a value on this field alone, so the branch may drop only `undefined`. */
  it("keeps an explicit `null` designation on the multipart branch", async () => {
    const wire = multipartTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({
      body: "nobody owns this",
      resident: null,
      files: [new File(["a"], "shot.png")],
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.forms[0]?.get("resident")).toBe("null");
  });

  it("sends no designation part when the composer stated none", async () => {
    const wire = multipartTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });

    result.current.mutate({ body: "hi", files: [new File(["a"], "shot.png")] });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.forms[0]?.has("resident")).toBe(false);
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
