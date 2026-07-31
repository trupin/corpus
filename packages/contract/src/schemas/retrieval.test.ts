import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./pagination.js";
import { docFilterShape } from "./query.js";
import {
  HEADING_PATH_SEPARATOR,
  RELATIONS,
  RelatedDocSchema,
  RelatedDocsSchema,
  RelatedQuerySchema,
  RETRIEVAL_DEFAULT_LIMIT,
  RETRIEVAL_MAX_LIMIT,
  SEMANTIC_INDEX_STATES,
  SearchHitSchema,
  SearchQuerySchema,
  SearchResultsSchema,
} from "./retrieval.js";

const hit = {
  id: "doc_a1b2c3",
  title: "Mortgage options",
  headingPath: `Mortgage options${HEADING_PATH_SEPARATOR}Rates${HEADING_PATH_SEPARATOR}Fixed`,
  snippet: "the 30-year fixed rate assumption is 6.1%",
};

const turnHit = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  headingPath: "## agent · 2026-07-19T10:07:12Z",
  snippet: "I used 6.1% because the lender's sheet quotes it",
};

const relatedRow = {
  id: "doc_b2c3d4",
  title: "Lender comparison",
  excerpt: "Rates quoted by three lenders as of July.",
  relation: "linked" as const,
};

describe("the search query", () => {
  it("requires a query, since a ranked list with nothing to rank is a different endpoint", () => {
    expect(SearchQuerySchema.safeParse({}).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(SearchQuerySchema.parse({ q: "rates" }).q).toBe("rates");
  });

  /**
   * The parity that makes SHARED-006 Edit 7's "the structured filters are the
   * same set, with the same semantics" true by construction: the parameter set
   * is *computed* from the shared shape, so a filter added there lands here
   * without this test being edited.
   */
  it("carries the query, every shared filter and a cap — and nothing else", () => {
    expect(Object.keys(SearchQuerySchema.shape)).toEqual([
      "q",
      ...Object.keys(docFilterShape),
      "limit",
    ]);
  });

  it.each(["pinned", "sort", "offset"])(
    "declares no %s, the signed parameter list's three omissions",
    (name) => {
      expect(Object.keys(SearchQuerySchema.shape)).not.toContain(name);
    },
  );

  /**
   * Observed and written down once (sprint-019 TEST-662): queries are tolerant
   * by policy, so the three undeclared parameters are **stripped, not
   * rejected**. The route description is where a caller is told.
   */
  it("ignores an undeclared pinned, sort or offset rather than rejecting it", () => {
    const parsed = SearchQuerySchema.parse({
      q: "rates",
      sort: "relevance",
      offset: "10",
      pinned: "true",
    });
    expect(parsed).toEqual({ q: "rates", limit: RETRIEVAL_DEFAULT_LIMIT });
  });

  it("parses the shared filters with the collection query's own coercions", () => {
    const parsed = SearchQuerySchema.parse({
      q: "rates",
      type: "note,view",
      status: "archived",
      includeArchived: "true",
      tag: "finance",
      folder: "finance/loans",
      parent: "doc_a1b2c3",
      references: "doc_a1b2c3",
      agent: "engaged",
      author: "agent",
      since: "2026-07-19T10:00:00Z",
      due: "week",
      stale: "aging",
      unread: "1",
      needs: "me",
    });
    expect(parsed.includeArchived).toBe(true);
    expect(parsed.unread).toBe(true);
    expect(parsed.needs).toBe("me");
    expect(parsed.type).toBe("note,view");
  });

  it.each(["nope", "", "later"])("rejects an out-of-vocabulary filter value (%s)", (value) => {
    expect(SearchQuerySchema.safeParse({ q: "rates", status: value }).success).toBe(false);
  });

  it("defaults the cap and refuses one past the maximum", () => {
    expect(SearchQuerySchema.parse({ q: "rates" }).limit).toBe(RETRIEVAL_DEFAULT_LIMIT);
    expect(SearchQuerySchema.parse({ q: "rates", limit: "5" }).limit).toBe(5);
    expect(SearchQuerySchema.parse({ q: "rates", limit: String(RETRIEVAL_MAX_LIMIT) }).limit).toBe(
      RETRIEVAL_MAX_LIMIT,
    );
    expect(
      SearchQuerySchema.safeParse({ q: "rates", limit: String(RETRIEVAL_MAX_LIMIT + 1) }).success,
    ).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "rates", limit: "0" }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "rates", limit: "2.5" }).success).toBe(false);
  });

  /**
   * The cap is a decision, not an inheritance (sprint-019 TEST-671): retrieval
   * is read by an agent that pays per line, so it sits well below the list
   * convention it deliberately does not reuse.
   */
  it("caps well below the list endpoints, on purpose", () => {
    expect(RETRIEVAL_DEFAULT_LIMIT).toBeLessThan(DEFAULT_PAGE_LIMIT);
    expect(RETRIEVAL_MAX_LIMIT).toBeLessThan(MAX_PAGE_LIMIT);
  });
});

describe("a search hit", () => {
  it.each([
    ["a document hit", hit],
    ["a turn hit", turnHit],
  ])("round-trips %s", (_name, value) => {
    expect(SearchHitSchema.parse(value)).toEqual(value);
  });

  it("is an address and a line of context — four fields, and no body among them", () => {
    expect(Object.keys(SearchHitSchema.shape)).toEqual(["id", "title", "headingPath", "snippet"]);
  });

  it.each(["body", "excerpt", "segments", "score"])("carries no %s, ever", (field) => {
    const parsed = SearchHitSchema.parse({ ...hit, [field]: "leaked" });
    expect(parsed).not.toHaveProperty(field);
    expect(parsed).toEqual(hit);
  });

  it.each(["id", "title", "headingPath", "snippet"])("requires %s", (field) => {
    const { [field]: _dropped, ...rest } = hit as Record<string, string>;
    expect(SearchHitSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an id that is not a document id", () => {
    expect(SearchHitSchema.safeParse({ ...hit, id: "mortgage.md" }).success).toBe(false);
  });
});

describe("the response envelopes carry Phase B's seam and nothing behind it", () => {
  it("parses a Phase A response that omits the semantic state entirely", () => {
    const parsed = SearchResultsSchema.parse({ hits: [hit] });
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.semanticIndex).toBeUndefined();
  });

  it("parses Phase A's other answer, an explicit `current`", () => {
    expect(SearchResultsSchema.parse({ hits: [], semanticIndex: "current" }).semanticIndex).toBe(
      "current",
    );
  });

  /**
   * The freeze, stated as a test: a Phase B response saying ranking is degraded
   * parses today, through the same shape, with no field added or moved.
   */
  it.each(SEMANTIC_INDEX_STATES.filter((state) => state !== "current"))(
    "parses a not-yet-current `%s` without a shape change",
    (state) => {
      const parsed = SearchResultsSchema.parse({ hits: [hit], semanticIndex: state });
      expect(parsed.semanticIndex).toBe(state);
      expect(parsed.semanticIndex === "current").toBe(false);
    },
  );

  it("rejects a state outside the published vocabulary", () => {
    expect(SearchResultsSchema.safeParse({ hits: [], semanticIndex: "unknown" }).success).toBe(
      false,
    );
  });

  it("carries the same seam on the related envelope, which Phase B degrades too", () => {
    expect(Object.keys(SearchResultsSchema.shape)).toEqual(["hits", "semanticIndex"]);
    expect(Object.keys(RelatedDocsSchema.shape)).toEqual(["related", "semanticIndex"]);
    expect(RelatedDocsSchema.parse({ related: [relatedRow] }).semanticIndex).toBeUndefined();
  });

  it("pages neither result set, since a ranking is a top-k rather than a page", () => {
    expect(Object.keys(SearchResultsSchema.shape)).not.toContain("page");
    expect(Object.keys(RelatedDocsSchema.shape)).not.toContain("page");
  });
});

describe("a related document", () => {
  it("round-trips", () => {
    expect(RelatedDocSchema.parse(relatedRow)).toEqual(relatedRow);
  });

  it("is id, title, one line, and why", () => {
    expect(Object.keys(RelatedDocSchema.shape)).toEqual(["id", "title", "excerpt", "relation"]);
  });

  it.each(["body", "path", "snippets"])("carries no %s", (field) => {
    expect(RelatedDocSchema.parse({ ...relatedRow, [field]: "leaked" })).toEqual(relatedRow);
  });

  /**
   * The shape freeze's other half: Phase A produces only `linked`, but all
   * three relations parse today, so Phase B adds semantic neighbours to this
   * list without widening an enum a client already switched on.
   */
  it.each(RELATIONS)(
    "accepts the frozen relation %s, though Phase A emits only `linked`",
    (relation) => {
      expect(RelatedDocSchema.parse({ ...relatedRow, relation }).relation).toBe(relation);
    },
  );

  it("publishes exactly the three relations SPEC.md §9.2 names", () => {
    expect(RELATIONS).toEqual(["linked", "similar", "both"]);
  });

  it("rejects a relation outside them", () => {
    expect(RelatedDocSchema.safeParse({ ...relatedRow, relation: "sibling" }).success).toBe(false);
  });
});

describe("the related query", () => {
  it("takes a cap and the archived flag, and nothing else", () => {
    expect(Object.keys(RelatedQuerySchema.shape)).toEqual(["limit", "includeArchived"]);
  });

  it("shares ranked search's cap", () => {
    const parsed = RelatedQuerySchema.parse({});
    expect(parsed.limit).toBe(RETRIEVAL_DEFAULT_LIMIT);
    expect(parsed.includeArchived).toBeUndefined();
    expect(RelatedQuerySchema.safeParse({ limit: String(RETRIEVAL_MAX_LIMIT + 1) }).success).toBe(
      false,
    );
  });

  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads includeArchived=%s as %s", (raw, expected) => {
    expect(RelatedQuerySchema.parse({ includeArchived: raw }).includeArchived).toBe(expected);
  });

  it.each(["maybe", "archived", ""])("rejects includeArchived=%s", (raw) => {
    expect(RelatedQuerySchema.safeParse({ includeArchived: raw }).success).toBe(false);
  });
});

describe("the heading-path separator", () => {
  it("is pinned here so the server and every client render one address format", () => {
    expect(HEADING_PATH_SEPARATOR).toBe(" › ");
  });

  it("is a display join, so a path with more levels is still one line", () => {
    const path = ["Mortgage options", "Rates", "Fixed"].join(HEADING_PATH_SEPARATOR);
    expect(path).not.toContain("\n");
    expect(SearchHitSchema.parse({ ...hit, headingPath: path }).headingPath).toBe(path);
  });
});
