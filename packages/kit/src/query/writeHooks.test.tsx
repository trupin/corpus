/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, docKey, lockKey, LOCKS_KEY, threadKey } from "./keys.js";
import { useBreakLock } from "./useBreakLock.js";
import { useDeleteDoc } from "./useDeleteDoc.js";
import { useMarkThreadSeen, useSetThreadStatus } from "./useThreadStatus.js";

/**
 * The four write hooks UI-005 adds. Each one asserts the same two things: the
 * request that reaches the wire, and the keys invalidated afterwards — because
 * a mutation that writes correctly and invalidates the wrong key leaves the
 * board serving stale state forever, and nothing else would catch it.
 */

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Capture[];
}

function transport(payload: unknown, status = 200, hold?: Promise<void>): Wire {
  const calls: Capture[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    if (hold !== undefined) await hold;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

function spyInvalidations(harness: ReturnType<typeof createCorpusTestHarness>): unknown[][] {
  const seen: unknown[][] = [];
  vi.spyOn(harness.queryClient, "invalidateQueries").mockImplementation((filters) => {
    seen.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });
  return seen;
}

describe("useDeleteDoc", () => {
  it("DELETEs, and drops the caches of the threads it orphaned", async () => {
    const wire = transport({
      deletedId: "doc_a",
      orphanedThreadIds: ["th_1", "th_2"],
      warnings: [],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useDeleteDoc(), { wrapper: harness.Wrapper });

    result.current.mutate("doc_a");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(wire.calls).toEqual([{ method: "DELETE", path: "/api/docs/doc_a", body: undefined }]);
    expect(keys).toEqual([docKey("doc_a"), DOCS_KEY, threadKey("th_1"), threadKey("th_2")]);
  });

  it("surfaces a refusal rather than pretending the document went away", async () => {
    const wire = transport({ code: "forbidden", message: "deletion is user-only" }, 403);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useDeleteDoc(), { wrapper: harness.Wrapper });

    result.current.mutate("doc_a");
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("deletion is user-only");
  });
});

describe("useSetThreadStatus", () => {
  it.each([
    [true, "/api/threads/th_1/resolve"],
    [false, "/api/threads/th_1/reopen"],
  ])("posts to the right verb (resolved=%s)", async (resolved, path) => {
    const wire = transport({ thread: { id: "th_1" }, warnings: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetThreadStatus(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_1", resolved });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls[0]?.path).toBe(path);
    expect(wire.calls[0]?.method).toBe("POST");
  });

  it("invalidates the thread, its document reader and every list showing it", async () => {
    const wire = transport({ thread: { id: "th_1" }, warnings: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useSetThreadStatus(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_1", resolved: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(keys).toEqual([threadKey("th_1"), docKey("th_1"), DOCS_KEY]);
  });
});

/**
 * Why `SettledCallbacks` exists at all (UI-012).
 *
 * This is a characterization test of TanStack Query v5, not of our code: a
 * per-call `mutate(…, { onSuccess })` is delivered through the observer and
 * skipped once that observer has no listeners, while a callback given to
 * `useMutation` rides on the mutation itself. If a future version changed
 * that, every "close the menu and toast" call site would silently change
 * behaviour — so the difference is asserted rather than remembered.
 */
describe("callbacks and observer teardown", () => {
  it("delivers the hook's callback after unmount and drops the call's", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const wire = transport({ thread: { id: "th_1" }, warnings: [] }, 200, held);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const fromHook: string[] = [];
    const fromCall: string[] = [];

    const { result, unmount } = renderHook(
      () =>
        useSetThreadStatus({
          onSuccess: (_result, variables) => fromHook.push(variables.id),
        }),
      { wrapper: harness.Wrapper },
    );

    result.current.mutate(
      { id: "th_1", resolved: true },
      { onSuccess: () => fromCall.push("th_1") },
    );
    await waitFor(() => {
      expect(wire.calls).toHaveLength(1);
    });

    unmount();
    release();

    await waitFor(() => {
      expect(fromHook).toEqual(["th_1"]);
    });
    expect(fromCall).toEqual([]);
  });
});

describe("useMarkThreadSeen", () => {
  it("posts a bare mark — displayed content only, up to the last turn", async () => {
    const wire = transport({
      threadId: "th_1",
      lastSeenTs: "2026-07-02T09:00:00.000Z",
      unread: false,
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useMarkThreadSeen(), { wrapper: harness.Wrapper });

    result.current.mutate("th_1");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/threads/th_1/seen", body: undefined },
    ]);
  });
});

describe("useBreakLock", () => {
  it("breaks the lock and refreshes everything the lock was gating", async () => {
    const wire = transport({ docId: "doc_a", released: true, holder: "agent" });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useBreakLock(), { wrapper: harness.Wrapper });

    result.current.mutate("doc_a");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(wire.calls[0]).toEqual({
      method: "POST",
      path: "/api/locks/doc_a/break",
      body: undefined,
    });
    expect(result.current.data).toEqual({ docId: "doc_a", released: true, holder: "agent" });
    expect(keys).toEqual([lockKey("doc_a"), LOCKS_KEY, docKey("doc_a"), DOCS_KEY]);
  });

  it("re-reads lock state on failure rather than claiming a break that did not happen", async () => {
    const wire = transport({ code: "not_found", message: "no lock on doc_a" }, 404);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useBreakLock(), { wrapper: harness.Wrapper });

    result.current.mutate("doc_a");
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(keys).toEqual([LOCKS_KEY]);
  });
});
