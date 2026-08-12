/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, docKey, docsListKey } from "./keys.js";
import { useSetDocArchived } from "./useSetDocArchived.js";

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
        ? { doc: { frontmatter: { id: "doc_a" } }, warnings: [] }
        : { code: "conflict", message: "the document has moved on" };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch, calls };
}

describe("useSetDocArchived", () => {
  /**
   * The whole point of the hook (UI-020). `PUT {status: "archived"}` sets the
   * frontmatter key and leaves a skill's folder in `.claude/skills/`; only the
   * route moves it.
   */
  it.each([
    [true, "/api/docs/doc_a/archive"],
    [false, "/api/docs/doc_a/unarchive"],
  ])("POSTs to the route that owns the transition (archived: %s)", async (archived, path) => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetDocArchived(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "doc_a", archived });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // No body at all: the id in the path is the whole request.
    expect(wire.calls).toEqual([{ method: "POST", path, body: undefined }]);
    expect(wire.calls.every((call) => call.method !== "PUT")).toBe(true);
  });

  it("addresses a different document per call from one mounted hook", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetDocArchived(), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_a", archived: true });
    await result.current.mutateAsync({ id: "doc_b", archived: false });

    expect(wire.calls.map((call) => call.path)).toEqual([
      "/api/docs/doc_a/archive",
      "/api/docs/doc_b/unarchive",
    ]);
  });

  it("writes nothing into the cache before the server has agreed", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), {
      frontmatter: { id: "doc_a", status: "open" },
    });
    const { result } = renderHook(() => useSetDocArchived(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "doc_a", archived: true });
    // Which lists a document belongs to is the server's to compute — and for a
    // skill this call also moves a folder, which can be refused.
    expect(harness.queryClient.getQueryData(docKey("doc_a"))).toEqual({
      frontmatter: { id: "doc_a", status: "open" },
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it("invalidates the document and every list, exactly as a doc write does", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docKey("doc_a"), { frontmatter: {} });
    harness.queryClient.setQueryData(docsListKey({ pinned: "true" }), { items: [], page: {} });
    const { result } = renderHook(() => useSetDocArchived(), { wrapper: harness.Wrapper });

    await result.current.mutateAsync({ id: "doc_a", archived: false });

    expect(harness.queryClient.getQueryState(docKey("doc_a"))?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(docsListKey({ pinned: "true" }))?.isInvalidated).toBe(
      true,
    );
    expect(DOCS_KEY).toEqual(["docs"]);
  });

  /** The teardown-safe seam (UI-012): the menu closes before the write settles. */
  it("reports through the hook's callbacks, which outlive the caller", async () => {
    const onSuccess = vi.fn();
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetDocArchived({ onSuccess }), {
      wrapper: harness.Wrapper,
    });

    await result.current.mutateAsync({ id: "doc_a", archived: false });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0]?.[1]).toEqual({ id: "doc_a", archived: false });
  });

  it("surfaces a refusal rather than swallowing it", async () => {
    const onError = vi.fn();
    const wire = transport(409);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetDocArchived({ onError }), {
      wrapper: harness.Wrapper,
    });

    result.current.mutate({ id: "doc_a", archived: true });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("the document has moved on");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
