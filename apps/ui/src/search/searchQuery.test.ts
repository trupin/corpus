import { describe, expect, it } from "vitest";
import {
  describeQuery,
  EMPTY_SEARCH_QUERY,
  fromViewFrontmatter,
  isEmptyQuery,
  toApiParams,
  toViewFrontmatter,
  type SearchQuery,
} from "./searchQuery";

/** Every chip set at once — the combination the round trip has to survive. */
const FULL: SearchQuery = {
  text: "mortgage",
  type: "note,thread",
  tag: "housing",
  status: "open",
  folder: "finance",
  since: "2026-07-01T00:00:00.000Z",
  due: "week",
  unread: true,
  references: "doc_rates",
  agent: "requested",
  needs: "form",
  parent: "doc_mortgage",
  includeArchived: true,
};

describe("toApiParams", () => {
  it("sends nothing at all for an untouched query", () => {
    expect(toApiParams(EMPTY_SEARCH_QUERY)).toEqual({});
    expect(isEmptyQuery(EMPTY_SEARCH_QUERY)).toBe(true);
  });

  it("pairs `q` with relevance sorting, and never sends relevance without it", () => {
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, text: "mortgage" })).toEqual({
      q: "mortgage",
      sort: "relevance",
    });
    // `sort=relevance` is rejected with 400 without a `q`; a filters-only search
    // takes the server's own default ordering instead.
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, folder: "finance" })).toEqual({
      folder: "finance",
    });
  });

  it("trims the query text rather than searching for whitespace", () => {
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, text: "  rates  " })).toEqual({
      q: "rates",
      sort: "relevance",
    });
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, text: "   " })).toEqual({});
  });

  it.each([
    ["type", { type: "note,view" }, { type: "note,view" }],
    ["tag", { tag: "housing" }, { tag: "housing" }],
    ["status", { status: "resolved" as const }, { status: "resolved" }],
    ["folder", { folder: "finance/housing" }, { folder: "finance/housing" }],
    ["since", { since: "2026-07-01T00:00:00.000Z" }, { since: "2026-07-01T00:00:00.000Z" }],
    ["due", { due: "overdue" }, { due: "overdue" }],
    ["unread", { unread: true }, { unread: true }],
    ["references", { references: "doc_b" }, { references: "doc_b" }],
    ["agent", { agent: "engaged" as const }, { agent: "engaged" }],
    ["needs", { needs: "form" as const }, { needs: "form" }],
    ["parent", { parent: "doc_a" }, { parent: "doc_a" }],
  ])("the %s chip is exactly one query parameter", (_name, chip, expected) => {
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, ...chip })).toEqual(expected);
  });

  it("omits a false toggle rather than sending `false`", () => {
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, unread: false })).toEqual({});
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, includeArchived: false })).toEqual({});
  });

  it("expresses the archived default by omitting `status`, never by naming one", () => {
    // `docs/query.ts` reads `status === undefined ? d.status <> 'archived' : …`,
    // so the default lives on the server and the client's job is silence.
    const params = toApiParams({ ...EMPTY_SEARCH_QUERY, text: "mortgage" });
    expect(params.status).toBeUndefined();
    expect("includeArchived" in params).toBe(false);
  });

  it("lifts the archived exclusion with `includeArchived`, not with `status=archived`", () => {
    const params = toApiParams({ ...EMPTY_SEARCH_QUERY, includeArchived: true });
    expect(params).toEqual({ includeArchived: true });
    // `status=archived` narrows to archived-only, which is the opposite of what
    // the chip's label promises (sprint-010 Open Conflict 3).
    expect(params.status).toBeUndefined();
  });

  it("keeps an explicit status chip and the archived toggle independent", () => {
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, status: "archived" })).toEqual({
      status: "archived",
    });
    expect(toApiParams({ ...EMPTY_SEARCH_QUERY, status: "open", includeArchived: true })).toEqual({
      status: "open",
      includeArchived: true,
    });
  });

  it("composes every chip into one request", () => {
    expect(toApiParams(FULL)).toEqual({
      q: "mortgage",
      sort: "relevance",
      type: "note,thread",
      tag: "housing",
      status: "open",
      folder: "finance",
      since: "2026-07-01T00:00:00.000Z",
      due: "week",
      unread: true,
      references: "doc_rates",
      agent: "requested",
      needs: "form",
      parent: "doc_mortgage",
      includeArchived: true,
    });
  });
});

describe("toViewFrontmatter", () => {
  it("is the same map, as the strings a YAML view document holds", () => {
    expect(toViewFrontmatter(FULL)).toEqual({
      q: "mortgage",
      sort: "relevance",
      type: "note,thread",
      tag: "housing",
      status: "open",
      folder: "finance",
      since: "2026-07-01T00:00:00.000Z",
      due: "week",
      unread: "true",
      references: "doc_rates",
      agent: "requested",
      needs: "form",
      parent: "doc_mortgage",
      includeArchived: "true",
    });
  });

  it("writes nothing for an empty search, so a saved view is not a lie", () => {
    expect(toViewFrontmatter(EMPTY_SEARCH_QUERY)).toEqual({});
  });
});

describe("the round trip", () => {
  const cases: readonly [string, SearchQuery][] = [
    ["empty", EMPTY_SEARCH_QUERY],
    ["text only", { ...EMPTY_SEARCH_QUERY, text: "mortgage" }],
    ["filters without text", { ...EMPTY_SEARCH_QUERY, folder: "finance", type: "thread" }],
    ["the archived default", { ...EMPTY_SEARCH_QUERY, text: "rates" }],
    ["archived included", { ...EMPTY_SEARCH_QUERY, text: "rates", includeArchived: true }],
    ["archived only", { ...EMPTY_SEARCH_QUERY, status: "archived" }],
    ["everything", FULL],
  ];

  it.each(cases)(
    "a view document written from a %s search re-reads as the same request",
    (_name, query) => {
      const reread = fromViewFrontmatter(toViewFrontmatter(query));
      expect(toApiParams(reread)).toEqual(toApiParams(query));
    },
  );

  it("reads a hand-written view query without inventing chips", () => {
    expect(fromViewFrontmatter({ folder: "finance", sort: "order" })).toEqual({
      ...EMPTY_SEARCH_QUERY,
      folder: "finance",
    });
  });

  it("treats anything but `true` as off", () => {
    expect(fromViewFrontmatter({ unread: "false" }).unread).toBe(false);
    expect(fromViewFrontmatter({ includeArchived: "" }).includeArchived).toBe(false);
  });
});

describe("describeQuery", () => {
  it("names a saved view after the text that produced it", () => {
    expect(describeQuery({ ...EMPTY_SEARCH_QUERY, text: "  mortgage  " })).toBe("mortgage");
  });

  it("falls back to the filters when there is no text", () => {
    expect(describeQuery({ ...EMPTY_SEARCH_QUERY, folder: "finance", unread: true })).toBe(
      "folder: finance · unread: true",
    );
  });

  it("never returns an empty column name", () => {
    expect(describeQuery(EMPTY_SEARCH_QUERY)).toBe("All documents");
  });
});
