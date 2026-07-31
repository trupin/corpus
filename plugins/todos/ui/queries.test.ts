/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { pluginKey } from "@corpus/kit";
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { docsFingerprint, listsPath, TODO_LISTS_KEY, useTodoLists } from "./queries.js";
import { listPayload } from "./testing.js";

afterEach(cleanup);

/**
 * The plugin's query keys, pinned against the kit's own builder.
 *
 * This is the key `server/routes.ts` announces through
 * `broadcastInvalidate([["lists"]])` — the context prefixes `["x", "todos", …]`
 * onto it. Building it here with `pluginKey` rather than writing the literal is
 * what makes a rename a compile error on both sides instead of a query that
 * quietly never refetches.
 */
describe("the todos plugin's query key", () => {
  it("namespaces the collection under x/todos", () => {
    expect(TODO_LISTS_KEY).toEqual(["x", "todos", "lists"]);
    expect(TODO_LISTS_KEY).toEqual(pluginKey("todos", "lists"));
  });
});

/**
 * TEST-511. The mechanism, checked directly rather than inferred from the
 * symptom: a column keyed on something a core write does not touch passes every
 * rendering test and still goes stale on the app's most ordinary interaction.
 */
describe("the (id, updated) fingerprint", () => {
  const row = (id: string, updated: string | null): DocRow =>
    docRowFixture({ id, type: "todo", title: id, updated });

  it("changes when any document's `updated` changes — which a core body edit stamps", () => {
    const before = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:00.000Z"),
    ]);
    const after = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:01.000Z"),
    ]);
    expect(after).not.toBe(before);
  });

  it("changes when a document appears or disappears", () => {
    const one = docsFingerprint([row("doc_a", "2026-07-20T09:00:00.000Z")]);
    const two = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:00.000Z"),
    ]);
    expect(two).not.toBe(one);
    expect(docsFingerprint([])).not.toBe(one);
  });

  it("is stable for an unchanged result set, so an idle board does not refetch", () => {
    const rows = [row("doc_a", "2026-07-20T09:00:00.000Z"), row("doc_b", null)];
    expect(docsFingerprint(rows)).toBe(docsFingerprint([...rows]));
  });

  it("tolerates a document with no timestamp at all", () => {
    expect(docsFingerprint([row("doc_a", null)])).not.toBe(
      docsFingerprint([row("doc_a", "2026-07-20T09:00:00.000Z")]),
    );
  });

  /**
   * The load-bearing property: the aggregate's key **extends**
   * `["x","todos","lists"]`, and TanStack invalidation matches by prefix — so
   * the plugin's own broadcast still reaches this query. The fingerprint is
   * added beside the shipped invalidation path, never instead of it (TEST-510).
   */
  it("produces a path whose query key still starts with the broadcast key", () => {
    const path = listsPath("abc123");
    expect(path).toBe("lists/at/abc123");
    const key = pluginKey("todos", ...path.split("/"));
    expect(key).toEqual(["x", "todos", "lists", "at", "abc123"]);
    expect(key.slice(0, TODO_LISTS_KEY.length)).toEqual(TODO_LISTS_KEY);
  });

  it("stays short enough to live in a URL, whatever the workspace holds", () => {
    const many = Array.from({ length: 200 }, (_entry, index) =>
      row(`doc_${String(index)}`, "2026-07-20T09:00:00.000Z"),
    );
    expect(docsFingerprint(many).length).toBeLessThanOrEqual(8);
  });
});

/**
 * TEST-30 / PLUGINS-007 AC3, asserted through the hook rather than through the
 * key shape.
 *
 * Every test above proves the fingerprint is a *different value*; none of them
 * proves the mounted hook turns that into a *second request*. The gap matters:
 * the join could be broken by anything between the two — `enabled`, a stale
 * `docs.data` reference, the path builder — and the shape assertions would all
 * still pass while the column silently showed yesterday's counts after the
 * app's most ordinary interaction.
 */
describe("useTodoLists, mounted", () => {
  /** A transport whose `/api/docs` answer a test can change mid-flight. */
  function wire(): {
    fetch: typeof globalThis.fetch;
    paths: string[];
    setRows: (rows: readonly DocRow[]) => void;
    setLists: (lists: readonly Record<string, unknown>[]) => void;
  } {
    let rows: readonly DocRow[] = [
      docRowFixture({ id: "doc_a", type: "todo", title: "A", updated: "2026-07-20T09:00:00.000Z" }),
    ];
    let lists: readonly Record<string, unknown>[] = [
      listPayload("doc_a", "A", [{ text: "one", done: false }]),
    ];
    const paths: string[] = [];
    const json = (value: unknown): Response =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return {
      paths,
      setRows: (next) => (rows = next),
      setLists: (next) => (lists = next),
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        paths.push(url.pathname);
        if (url.pathname.startsWith("/api/x/todos/lists")) return Promise.resolve(json({ lists }));
        return Promise.resolve(
          json({ items: rows, page: { total: rows.length, limit: 50, offset: 0 } }),
        );
      },
    };
  }

  const aggregateCalls = (paths: readonly string[]): readonly string[] =>
    paths.filter((path) => path.startsWith("/api/x/todos/lists"));

  it("issues one aggregate request per fingerprint, and refetches when it changes", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useTodoLists(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.all[0]?.items).toEqual([{ text: "one", done: false }]);
    const first = aggregateCalls(transport.paths);
    expect(first).toHaveLength(1);

    // A **core** body edit: the document's `updated` moves and core broadcasts
    // `["docs"]`, which names nothing under `x/todos`. Before the fingerprint
    // this is exactly where the column went stale.
    transport.setRows([
      docRowFixture({ id: "doc_a", type: "todo", title: "A", updated: "2026-07-20T09:05:00.000Z" }),
    ]);
    transport.setLists([listPayload("doc_a", "A", [{ text: "one", done: true }])]);
    await harness.queryClient.invalidateQueries({ queryKey: ["docs"] });

    await waitFor(() => {
      expect(result.current.all[0]?.items).toEqual([{ text: "one", done: true }]);
    });
    const after = aggregateCalls(transport.paths);
    expect(after).toHaveLength(2);
    // A *different* path, which is the mechanism — same key would have been a
    // cache hit and no request at all.
    expect(after[1]).not.toBe(after[0]);
    expect(after.every((path) => path.startsWith("/api/x/todos/lists/at/"))).toBe(true);
  });

  it("does not refetch the aggregate when nothing about the documents changed", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    renderHook(() => useTodoLists(), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(aggregateCalls(transport.paths)).toHaveLength(1);
    });

    await harness.queryClient.invalidateQueries({ queryKey: ["docs"] });
    await waitFor(() => {
      expect(transport.paths.filter((path) => path === "/api/docs").length).toBeGreaterThan(1);
    });
    // The rows came back identical, so the key is identical and the aggregate
    // is a cache hit: an idle board does not re-fetch every list on every tick.
    expect(aggregateCalls(transport.paths)).toHaveLength(1);
  });

  it("reports a shape it does not understand rather than rendering nothing", async () => {
    const broken: typeof globalThis.fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = url.pathname.startsWith("/api/x/todos/lists")
        ? { lists: [{ docId: 7 }] }
        : { items: [], page: { total: 0, limit: 50, offset: 0 } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const harness = createCorpusTestHarness({ fetch: broken });
    const { result } = renderHook(() => useTodoLists(), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(result.current.error?.message).toContain("a shape this plugin does not understand");
    });
  });
});
