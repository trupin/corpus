/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { docsListKey, TREE_KEY } from "./keys.js";
import { useCreateDoc } from "./useCreateDoc.js";

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(status = 201): {
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
      status < 400
        ? {
            doc: { frontmatter: { id: "doc_new" }, body: "", path: "x.md", anchors: [] },
            warnings: [],
          }
        : { code: "bad_request", message: "`order` must be a number", issues: [] };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch, calls };
}

describe("useCreateDoc", () => {
  it("POSTs the board keys a `type: board` document carries", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateDoc(), { wrapper: harness.Wrapper });

    result.current.mutate({
      type: "board",
      title: "Finance",
      folder: "boards",
      order: 40,
      columns: ["doc_view_a", "doc_view_b"],
      defaultOpen: true,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      {
        method: "POST",
        path: "/api/docs",
        body: {
          type: "board",
          title: "Finance",
          folder: "boards",
          order: 40,
          columns: ["doc_view_a", "doc_view_b"],
          defaultOpen: true,
        },
      },
    ]);
    expect(result.current.data?.doc.frontmatter.id).toBe("doc_new");
  });

  it("invalidates every list and the folder tree, and writes nothing optimistically", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    harness.queryClient.setQueryData(docsListKey({ type: "board" }), { items: [], page: {} });
    harness.queryClient.setQueryData(TREE_KEY, { folders: [] });
    const { result } = renderHook(() => useCreateDoc(), { wrapper: harness.Wrapper });

    result.current.mutate({ type: "note", title: "Untitled" });
    // The server assigns the id, the path and the timestamps; a guess here would
    // be a different document from the one on disk.
    expect(harness.queryClient.getQueryData(docsListKey({ type: "board" }))).toEqual({
      items: [],
      page: {},
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(harness.queryClient.getQueryState(docsListKey({ type: "board" }))?.isInvalidated).toBe(
      true,
    );
    expect(harness.queryClient.getQueryState(TREE_KEY)?.isInvalidated).toBe(true);
  });

  it("surfaces a rejection rather than swallowing it", async () => {
    const wire = transport(400);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateDoc(), { wrapper: harness.Wrapper });

    result.current.mutate({ type: "view", title: "Broken" });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("`order` must be a number");
  });
});
