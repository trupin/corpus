/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "../search/searchQuery";
import { boardTransport, viewRow } from "../testing/boardFixture";
import { sameQuery, useSaveAsView } from "./useSaveAsView";

afterEach(cleanup);

const QUERY: SearchQuery = { ...EMPTY_SEARCH_QUERY, text: "mortgage", folder: "finance" };

function setup(views: readonly ReturnType<typeof viewRow>[] = []) {
  const wire = boardTransport({ views });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const view = renderHook(() => useSaveAsView(), { wrapper: harness.Wrapper });
  return { ...view, wire };
}

describe("useSaveAsView", () => {
  it("creates one pinned `type: view` document holding the search and a trailing order", async () => {
    const { result, wire } = setup([
      viewRow({ id: "col_a", order: 10 }),
      viewRow({ id: "col_b", order: 20 }),
    ]);
    await waitFor(() => {
      expect(wire.calls.length).toBeGreaterThan(0);
    });

    const saved = await result.current.save(QUERY);

    const posts = wire.writes("POST");
    expect(posts.length).toBe(1);
    expect(posts[0]?.path).toBe("/api/docs");
    expect(posts[0]?.body).toEqual({
      type: "view",
      title: "mortgage",
      folder: "views",
      pinned: true,
      order: 30,
      evergreen: true,
      query: { q: "mortgage", sort: "relevance", folder: "finance" },
    });
    expect(saved.docId).toBe("doc_created");
    expect(saved.duplicate).toBe(false);
  });

  it("names an unnamed search after its filters rather than creating a blank column", async () => {
    const { result, wire } = setup();
    await result.current.save({ ...EMPTY_SEARCH_QUERY, unread: true, status: "open" });
    expect(wire.writes("POST")[0]?.body).toMatchObject({
      title: "status: open · unread: true",
      query: { status: "open", unread: "true" },
    });
  });

  it("starts a first column at the first order step", async () => {
    const { result, wire } = setup();
    await result.current.save(QUERY);
    expect((wire.writes("POST")[0]?.body as { order: number }).order).toBe(10);
  });

  it("warns about a matching column but creates the view anyway", async () => {
    const existing = viewRow({
      id: "col_same",
      order: 10,
      query: { q: "mortgage", sort: "relevance", folder: "finance" },
    });
    const { result, wire } = setup([existing]);
    await waitFor(() => {
      expect(wire.calls.length).toBeGreaterThan(0);
    });

    const saved = await result.current.save(QUERY);
    expect(saved.duplicate).toBe(true);
    // Views are documents; duplicates are the user's business.
    expect(wire.writes("POST").length).toBe(1);
  });

  it("does not call a column with a different query a duplicate", async () => {
    const { result, wire } = setup([
      viewRow({ id: "col_other", order: 10, query: { q: "mortgage", sort: "relevance" } }),
    ]);
    await waitFor(() => {
      expect(wire.calls.length).toBeGreaterThan(0);
    });
    expect((await result.current.save(QUERY)).duplicate).toBe(false);
  });

  it("rejects rather than reporting a column that was never written", async () => {
    const wire = boardTransport({ views: [], failing: { "/api/docs": 500 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSaveAsView(), { wrapper: harness.Wrapper });

    await expect(result.current.save(QUERY)).rejects.toThrow();
  });
});

describe("sameQuery", () => {
  it("compares compiled queries by value", () => {
    expect(sameQuery({ q: "a", folder: "b" }, { folder: "b", q: "a" })).toBe(true);
    expect(sameQuery({ q: "a" }, { q: "a", folder: "b" })).toBe(false);
    expect(sameQuery({ q: "a" }, { q: "b" })).toBe(false);
    expect(sameQuery({}, {})).toBe(true);
  });
});
