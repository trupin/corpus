/** @vitest-environment jsdom */
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFilter } from "../client/createCorpusClient.js";
import { createCorpusTestHarness } from "../testing/index.js";
import { docKey, docsListKey, HEALTH_KEY, LOCKS_KEY, threadKey, TREE_KEY } from "./keys.js";
import { useDoc } from "./useDoc.js";
import { useDocs } from "./useDocs.js";
import { useHealth } from "./useHealth.js";
import { useJobs } from "./useJobs.js";
import { useLocks } from "./useLocks.js";
import { useThread } from "./useThread.js";
import { useTree } from "./useTree.js";

const BODIES: Record<string, unknown> = {
  "/api/docs": { items: [{ id: "doc_a", title: "Budget", snippets: [] }], page: { total: 1 } },
  "/api/docs/doc_a": { id: "doc_a", title: "Budget" },
  "/api/threads/th_a": { id: "th_a", title: "A thread", turns: [] },
  "/api/tree": { folders: [{ name: "finance", count: 1, children: [] }] },
  "/api/jobs": { jobs: [] },
  "/api/locks": { locks: [] },
  "/api/health": { status: "ok", version: "9.9.9", uptimeSeconds: 1, workspace: "/tmp/ws" },
};

function routedFetch(): { readonly fetch: typeof globalThis.fetch; readonly urls: string[] } {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const request = new Request(input);
    const { pathname } = new URL(request.url);
    urls.push(request.url);
    return Promise.resolve(
      new Response(JSON.stringify(BODIES[pathname] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch: fetch, urls };
}

afterEach(cleanup);

/** One row per hook; the result type is erased so seven hooks share one table. */
type HookCase = readonly [
  name: string,
  hook: () => { readonly isSuccess: boolean },
  path: string,
  key: readonly unknown[],
];

describe("read hooks", () => {
  // TEST-39 + TEST-6: the operation AND the key each hook caches under.
  it.each<HookCase>([
    ["useDocs", () => useDocs({}), "/api/docs", docsListKey({})],
    ["useDoc", () => useDoc("doc_a"), "/api/docs/doc_a", docKey("doc_a")],
    ["useThread", () => useThread("th_a"), "/api/threads/th_a", threadKey("th_a")],
    ["useTree", () => useTree(), "/api/tree", TREE_KEY],
    ["useJobs", () => useJobs({}), "/api/jobs", ["jobs", {}]],
    ["useLocks", () => useLocks(), "/api/locks", LOCKS_KEY],
    ["useHealth", () => useHealth(), "/api/health", HEALTH_KEY],
  ])("%s calls %s and caches under the contract's key", async (_name, hook, path, key) => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(hook, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(transport.urls.map((url) => new URL(url).pathname)).toEqual([path]);
    expect(harness.queryClient.getQueryData(key)).toBeDefined();
  });

  it("caches a document under `docs` and a thread under `threads`, not the singular", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(
      () => {
        useDoc("doc_a");
        useThread("th_a");
      },
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(["docs", "doc_a"])).toBeDefined();
      expect(harness.queryClient.getQueryData(["threads", "th_a"])).toBeDefined();
    });
    expect(harness.queryClient.getQueryData(["doc", "doc_a"])).toBeUndefined();
    expect(harness.queryClient.getQueryData(["thread", "th_a"])).toBeUndefined();
  });

  it("issues no request for an id that is not there yet", () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(
      () => {
        useDoc(undefined);
        useThread(undefined);
      },
      { wrapper: harness.Wrapper },
    );
    expect(transport.urls).toEqual([]);
  });

  // TEST-40: the FTS highlights UI-009 renders survive the hook.
  it("preserves search snippets on a `q` query", async () => {
    const transport = routedFetch();
    BODIES["/api/docs"] = {
      items: [
        {
          id: "doc_a",
          title: "Budget",
          snippets: [{ field: "body", segments: [{ text: "bud", match: true }] }],
        },
      ],
      page: { total: 1 },
    };
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useDocs({ q: "bud" }), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.items[0]?.snippets).toEqual([
      { field: "body", segments: [{ text: "bud", match: true }] },
    ]);
    BODIES["/api/docs"] = { items: [{ id: "doc_a", title: "Budget", snippets: [] }], page: {} };
  });

  it("surfaces a failed read as an error instead of throwing into the tree", async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { result } = renderHook(() => useTree(), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("Failed to fetch");
  });

  it("throws a named error when a hook is rendered outside a provider", () => {
    // React logs the thrown render error; silence it so the expectation reads.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useTree())).toThrow(/must be rendered inside a <CorpusProvider>/);
    errorSpy.mockRestore();
  });
});

// TEST-8: two callers with logically identical filters share one cache entry,
// so a column re-render cannot silently double the request rate.
describe("filter canonicalisation at the hook boundary", () => {
  it("issues exactly one request for two logically identical filter objects", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });

    // A filter assembled at runtime — chips cleared, a search box emptied —
    // carries explicit `undefined`s that `exactOptionalPropertyTypes` forbids
    // in a literal but that every real caller produces.
    const assembledAtRuntime: DocsFilter = {
      folder: "finance",
      tag: ["a", "b"],
      type: "note",
      q: undefined,
      parent: undefined,
    };

    function Two(): ReactElement {
      useDocs({ type: "note", tag: ["b", "a"], folder: "finance" });
      useDocs(assembledAtRuntime);
      return <div />;
    }

    render(<Two />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(transport.urls).toHaveLength(1);
    });
    expect(harness.queryClient.getQueryCache().findAll({ queryKey: ["docs"] })).toHaveLength(1);
  });

  it("issues two requests for filters that genuinely differ", async () => {
    const transport = routedFetch();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });

    function Two(): ReactElement {
      useDocs({ type: "note" });
      useDocs({ type: "view" });
      return <div />;
    }

    render(<Two />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(transport.urls).toHaveLength(2);
    });
  });
});
