/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, docKey, docsListKey } from "./keys.js";
import { useUpdateDoc, useUpdateDocById } from "./useUpdateDoc.js";

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
        ? {
            doc: { frontmatter: { id: "doc_a" } },
            anchors: { remapped: [], orphaned: [] },
            warnings: [],
          }
        : { code: "stale_key", message: "the document has moved on" };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch, calls };
}

describe("useUpdateDoc", () => {
  it("PUTs exactly the fields it is given", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useUpdateDoc("doc_a"), { wrapper: harness.Wrapper });

    result.current.mutate({ reviewed: "2026-07-27T12:00:00.000Z" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      {
        method: "PUT",
        path: "/api/docs/doc_a",
        body: { reviewed: "2026-07-27T12:00:00.000Z" },
      },
    ]);
  });

  it("writes nothing into the cache before the server has agreed", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), {
      frontmatter: { id: "doc_a", stale: null },
    });
    const { result } = renderHook(() => useUpdateDoc("doc_a"), { wrapper: harness.Wrapper });

    result.current.mutate({ status: "archived" });
    // The point of not being optimistic: the row's level is the server's to say.
    expect(harness.queryClient.getQueryData(docKey("doc_a"))).toEqual({
      frontmatter: { id: "doc_a", stale: null },
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it("invalidates the document and every list on success", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), { frontmatter: {} });
    harness.queryClient.setQueryData(docsListKey({ folder: "finance" }), { items: [], page: {} });
    const { result } = renderHook(() => useUpdateDoc("doc_a"), { wrapper: harness.Wrapper });

    result.current.mutate({ status: "archived" });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(harness.queryClient.getQueryState(docKey("doc_a"))?.isInvalidated).toBe(true);
    expect(
      harness.queryClient.getQueryState(docsListKey({ folder: "finance" }))?.isInvalidated,
    ).toBe(true);
    expect(DOCS_KEY).toEqual(["docs"]);
  });

  it("surfaces a refusal rather than swallowing it", async () => {
    const wire = transport(409);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useUpdateDoc("doc_a"), { wrapper: harness.Wrapper });

    result.current.mutate({ status: "archived" });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("the document has moved on");
  });
});

describe("useUpdateDocById", () => {
  it("addresses a different document per call from one mounted hook", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useUpdateDocById(), { wrapper: harness.Wrapper });

    // The reason this binding exists: one gesture, several documents, and hooks
    // cannot be called in a loop.
    await result.current.mutateAsync({ id: "doc_a", changes: { order: 5 } });
    await result.current.mutateAsync({ id: "doc_b", changes: { order: 15 } });

    expect(wire.calls).toEqual([
      { method: "PUT", path: "/api/docs/doc_a", body: { order: 5 } },
      { method: "PUT", path: "/api/docs/doc_b", body: { order: 15 } },
    ]);
  });

  it("invalidates the document it wrote and every list that could hold it", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_b"), { frontmatter: {} });
    harness.queryClient.setQueryData(docsListKey({ pinned: "true" }), { items: [], page: {} });
    const { result } = renderHook(() => useUpdateDocById(), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_b", changes: { order: 15 } });

    expect(harness.queryClient.getQueryState(docKey("doc_b"))?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(docsListKey({ pinned: "true" }))?.isInvalidated).toBe(
      true,
    );
  });

  it("surfaces a refusal rather than swallowing it", async () => {
    const wire = transport(409);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useUpdateDocById(), { wrapper: harness.Wrapper });

    await expect(
      result.current.mutateAsync({ id: "doc_a", changes: { order: 5 } }),
    ).rejects.toThrow(/the document has moved on/);
  });
});
