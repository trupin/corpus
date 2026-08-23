/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "../search/searchQuery";
import { boardTransport, DEFAULT_BOARD_ID, viewRow } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { sameQuery, useSaveAsView } from "./useSaveAsView";

afterEach(cleanup);

const QUERY: SearchQuery = { ...EMPTY_SEARCH_QUERY, text: "mortgage", folder: "finance" };

function setup(views: readonly ReturnType<typeof viewRow>[] = []) {
  const wire = boardTransport({ views });
  const harness = createBoardHarness(wire.fetch);
  const view = renderHook(() => useSaveAsView(), { wrapper: harness.Wrapper });
  return { ...view, wire };
}

describe("useSaveAsView", () => {
  /**
   * Two writes since rider 2: the view document, and its id appended to the
   * showing board's `columns`. The view itself carries no `pinned` and no
   * `order` — it is a saved query and nothing more.
   */
  it("creates a `type: view` document and lists it on the showing board", async () => {
    const { result, wire } = setup([viewRow({ id: "col_a" }), viewRow({ id: "col_b" })]);
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
      evergreen: true,
      query: { q: "mortgage", sort: "relevance", folder: "finance" },
    });
    expect(saved.docId).toBe("doc_created");
    expect(saved.duplicate).toBe(false);

    // …and the board now lists it, last.
    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      [`/api/docs/${DEFAULT_BOARD_ID}`, { columns: ["col_a", "col_b", "doc_created"] }],
    ]);
  });

  it("names an unnamed search after its filters rather than creating a blank column", async () => {
    const { result, wire } = setup();
    await result.current.save({ ...EMPTY_SEARCH_QUERY, unread: true, status: "open" });
    expect(wire.writes("POST")[0]?.body).toMatchObject({
      title: "status: open · unread: true",
      query: { status: "open", unread: "true" },
    });
  });

  it("lists the first column of an empty board", async () => {
    const { result, wire } = setup();
    await waitFor(() => {
      expect(wire.calls.length).toBeGreaterThan(0);
    });
    await result.current.save(QUERY);
    expect(wire.writes("PUT").map((call) => call.body)).toEqual([{ columns: ["doc_created"] }]);
  });

  it("warns about a matching column but creates the view anyway", async () => {
    const existing = viewRow({
      id: "col_same",
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
      viewRow({ id: "col_other", query: { q: "mortgage", sort: "relevance" } }),
    ]);
    await waitFor(() => {
      expect(wire.calls.length).toBeGreaterThan(0);
    });
    expect((await result.current.save(QUERY)).duplicate).toBe(false);
  });

  it("rejects rather than reporting a column that was never written", async () => {
    const wire = boardTransport({ views: [], failing: { "/api/docs": 500 } });
    const harness = createBoardHarness(wire.fetch);
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
