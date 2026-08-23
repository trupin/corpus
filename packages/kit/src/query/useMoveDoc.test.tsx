/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { TREE_KEY, docKey, docsListKey } from "./keys.js";
import { useMoveDoc } from "./useMoveDoc.js";

/**
 * `POST /api/docs/{id}/move` (UI-158). Two things can go wrong silently: the
 * request that reaches the wire, and the keys invalidated afterwards — a move
 * that writes correctly and leaves the tree stale draws the document under the
 * folder it just left, for the rest of the session.
 */

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(status = 200): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Capture[];
} {
  const calls: Capture[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    const payload =
      status === 200
        ? { doc: { frontmatter: { id: "doc_a" }, path: "data/docs/finance/a.md" }, warnings: [] }
        : { code: "validation", message: "data/docs/finance/a.md already exists" };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

describe("useMoveDoc", () => {
  it("POSTs the destination folder, byte for byte, to the move route", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useMoveDoc(), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_a", folder: "finance/mortgage" });

    // Not lower-cased and not prefixed: `data/docs/` is the server's to add.
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/docs/doc_a/move", body: { folder: "finance/mortgage" } },
    ]);
  });

  it("invalidates the document, every list, and the folder tree", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), { frontmatter: {} });
    harness.queryClient.setQueryData(docsListKey({ folder: "inbox" }), { items: [], page: {} });
    harness.queryClient.setQueryData(TREE_KEY, { folders: [] });
    const { result } = renderHook(() => useMoveDoc(), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_a", folder: "finance" });

    expect(harness.queryClient.getQueryState(docKey("doc_a"))?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(docsListKey({ folder: "inbox" }))?.isInvalidated).toBe(
      true,
    );
    // The tree counts documents per folder, and a move is the one document write
    // that changes those counts.
    expect(harness.queryClient.getQueryState(TREE_KEY)?.isInvalidated).toBe(true);
  });

  it("writes nothing into the cache before the server has agreed", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), {
      frontmatter: { id: "doc_a" },
      path: "data/docs/inbox/a.md",
    });
    const { result } = renderHook(() => useMoveDoc(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "doc_a", folder: "finance" });
    // The destination is the server's to resolve, and it may refuse it outright.
    expect(harness.queryClient.getQueryData(docKey("doc_a"))).toEqual({
      frontmatter: { id: "doc_a" },
      path: "data/docs/inbox/a.md",
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  /** The teardown-safe seam (UI-012): the menu closes before the write settles. */
  it("reports through the hook's callbacks, which outlive the caller", async () => {
    const onSuccess = vi.fn();
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useMoveDoc({ onSuccess }), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_a", folder: "finance" });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0]?.[1]).toEqual({ id: "doc_a", folder: "finance" });
  });

  it("surfaces a refused destination rather than swallowing it", async () => {
    const onError = vi.fn();
    const wire = transport(400);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useMoveDoc({ onError }), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "doc_a", folder: "finance" });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("already exists");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
