import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { degradedRankingNote, toSearchParams } from "./searchApi";
import {
  EMPTY_SEARCH_QUERY,
  toApiParams,
  toViewFrontmatter,
  type SearchQuery,
} from "./searchQuery";

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  ...EMPTY_SEARCH_QUERY,
  ...overrides,
});

describe("toSearchParams", () => {
  it("sends `q` and nothing else for a bare query", () => {
    expect(toSearchParams(query({ text: "mortgage" }))).toEqual({ q: "mortgage" });
  });

  it("carries every active chip on the one request", () => {
    expect(
      toSearchParams(
        query({
          text: "  mortgage  ",
          type: "note,view",
          tag: "finance",
          status: "open",
          folder: "finance/housing",
          since: "2026-07-01T00:00:00.000Z",
          due: "overdue",
          unread: true,
          references: "doc_a1b2c3",
          agent: "engaged",
          needs: "form",
          parent: "doc_a1b2c3",
        }),
      ),
    ).toEqual({
      q: "mortgage",
      type: "note,view",
      tag: "finance",
      status: "open",
      folder: "finance/housing",
      since: "2026-07-01T00:00:00.000Z",
      due: "overdue",
      unread: true,
      references: "doc_a1b2c3",
      agent: "engaged",
      needs: "form",
      parent: "doc_a1b2c3",
    });
  });

  it("never sends `sort` — ranked retrieval has one order, its ranking", () => {
    const params = toSearchParams(query({ text: "mortgage" }));
    expect(params).not.toHaveProperty("sort");
    // The `GET /api/docs` serializer still does, which is the fork's whole point.
    expect(toApiParams(query({ text: "mortgage" }))).toHaveProperty("sort", "relevance");
  });

  it("omits `status` by default, leaving the server's archived rule to apply", () => {
    const params = toSearchParams(query({ text: "rates" }));
    expect(params).not.toHaveProperty("status");
    expect(params).not.toHaveProperty("includeArchived");
  });

  it("lifts the archived default with `includeArchived`, never with a status", () => {
    const params = toSearchParams(query({ text: "rates", includeArchived: true }));
    expect(params).toMatchObject({ includeArchived: true });
    expect(params).not.toHaveProperty("status");
  });

  it("issues nothing at all without text — `q` is required, and chips are not a search", () => {
    expect(toSearchParams(query())).toBeUndefined();
    expect(toSearchParams(query({ text: "   " }))).toBeUndefined();
    expect(toSearchParams(query({ folder: "finance", unread: true }))).toBeUndefined();
  });
});

/**
 * The fork itself (sprint-022 C11): `toViewFrontmatter` **calls** `toApiParams`,
 * so the two are one grammar and repointing it would corrupt every saved view.
 * These assertions are the regression that would fail if a later change merged
 * the paths back together.
 */
describe("the save-as-view path is not the search path", () => {
  const cases: readonly SearchQuery[] = [
    query({ text: "mortgage" }),
    query({ text: "rates", folder: "finance", includeArchived: true }),
    query({ type: "thread", needs: "form", unread: true }),
    query({ text: "q", tag: "finance", status: "open", due: "week", agent: "requested" }),
  ];

  it("writes the `GET /api/docs` grammar into the view document, `sort` included", () => {
    expect(toViewFrontmatter(query({ text: "mortgage" }))).toEqual({
      q: "mortgage",
      sort: "relevance",
    });
  });

  it("keeps every stored view query a stringified `toApiParams`, for every shape", () => {
    for (const each of cases) {
      const stored = toViewFrontmatter(each);
      const expected = Object.fromEntries(
        Object.entries(toApiParams(each)).map(([key, value]) => [key, String(value)]),
      );
      expect(stored).toEqual(expected);
    }
  });

  it("differs from the search request exactly where the endpoints differ", () => {
    for (const each of cases) {
      const search = toSearchParams(each);
      if (search === undefined) continue;
      const list = toApiParams(each);
      expect(
        Object.keys(list)
          .filter((key) => key !== "sort")
          .sort(),
      ).toEqual(Object.keys(search).sort());
    }
  });

  it("leaves `searchQuery.ts`'s three serializers on the list endpoint, in source", () => {
    const source = readFileSync(new URL("./searchQuery.ts", import.meta.url), "utf8");
    // The module is the `GET /api/docs` grammar and says so; a `/api/search`
    // reference in it would mean the fork had been undone.
    expect(source).toContain("GET /api/docs");
    expect(source).not.toContain("/api/search");
    expect(source).toContain("q: text, sort: RELEVANCE_SORT");
  });
});

describe("degradedRankingNote", () => {
  it("says nothing when ranking is current", () => {
    expect(degradedRankingNote("current")).toBeNull();
  });

  it("says nothing when the field is absent — the server makes no claim", () => {
    expect(degradedRankingNote(undefined)).toBeNull();
  });

  it("names each degraded state's reason in one quiet sentence", () => {
    expect(degradedRankingNote("indexing")).toBe(
      "Ranked on text alone — the semantic index is still being built.",
    );
    expect(degradedRankingNote("stale")).toBe(
      "Ranked on text alone — some documents are not in the semantic index yet.",
    );
    expect(degradedRankingNote("disabled")).toBe(
      "Ranked on text alone — no semantic index is configured for this workspace.",
    );
  });

  it("still reads as degraded for a state this build has never heard of", () => {
    const note = degradedRankingNote("some-future-state");
    expect(note).toBe("Ranked on text alone — semantic ranking is unavailable right now.");
  });

  it("does not reuse the CLI's transcript wording", () => {
    for (const state of ["indexing", "stale", "disabled"]) {
      const note = degradedRankingNote(state) ?? "";
      expect(note.startsWith("#")).toBe(false);
      expect(note).not.toContain("SPEC.md");
      expect(note).not.toContain("lexical");
      expect(note).not.toContain(state);
    }
  });
});
