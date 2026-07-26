import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_SORT,
  DOC_SORTS,
  DUE_KEYWORDS,
  DocListSchema,
  DocRowSchema,
  DocsQuerySchema,
  DocSortSchema,
  DueKeywordSchema,
  NEEDS_FILTERS,
  NEEDS_REASONS,
  NeedsFilterSchema,
  NeedsReasonSchema,
  SNIPPET_FIELDS,
  SnippetFieldSchema,
  SnippetSchema,
  STALE_TIERS,
  StaleTierSchema,
} from "./query.js";

const row = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  path: "data/docs/finance/mortgage-options.md",
  status: "open",
  tags: ["finance"],
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  due: "2026-08-01",
  reviewed: "2026-07-20T09:00:00Z",
  evergreen: false,
  excerpt: "Body is plain markdown.",
  attention: [],
  snippets: [],
};

describe("DocsQuery pagination", () => {
  it("applies the pagination and sort defaults when only a filter is given", () => {
    expect(DocsQuerySchema.parse({ type: "thread" })).toEqual({
      type: "thread",
      limit: 50,
      offset: 0,
      sort: DEFAULT_DOC_SORT,
    });
  });

  it("leaves CONTRACT-001's pagination bounds untouched", () => {
    expect(DocsQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(DocsQuerySchema.parse({ limit: 200, offset: 5 })).toMatchObject({
      limit: 200,
      offset: 5,
    });
  });
});

describe("DocsQuery filter grammar", () => {
  it("carries every SPEC.md §9.2 filter through in one composed query", () => {
    const query = {
      q: "mortgage",
      type: "note,view",
      status: "archived",
      tag: "finance,house",
      folder: "finance",
      parent: "doc_a1b2c3",
      references: "th_x9y8",
      agent: "engaged",
      author: "agent",
      since: "2026-07-01T00:00:00Z",
      due: "overdue",
      stale: "stale",
      unread: "true",
      needs: "me",
      sort: "relevance",
    };
    expect(DocsQuerySchema.parse(query)).toMatchObject({
      ...query,
      unread: true,
      limit: 50,
      offset: 0,
    });
  });

  it.each(["open", "resolved", "archived"])("accepts the status %s", (status) => {
    expect(DocsQuerySchema.parse({ status }).status).toBe(status);
  });

  it("rejects an unknown status rather than ignoring the filter", () => {
    expect(DocsQuerySchema.safeParse({ status: "done" }).success).toBe(false);
  });

  it("rejects an empty full-text query rather than treating it as no filter", () => {
    expect(DocsQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("leaves `type` open, because plugins define their own document types", () => {
    expect(DocsQuerySchema.parse({ type: "todo" }).type).toBe("todo");
  });

  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads unread=%s as the boolean it spells", (raw, expected) => {
    expect(DocsQuerySchema.parse({ unread: raw }).unread).toBe(expected);
  });

  /** A coerced boolean would read `"false"` as true; a string-boolean rejects nonsense instead. */
  it.each(["maybe", "1x", ""])("rejects unread=%s rather than coercing it to true", (raw) => {
    expect(DocsQuerySchema.safeParse({ unread: raw }).success).toBe(false);
  });

  it.each(DUE_KEYWORDS)("accepts the due keyword %s", (keyword) => {
    expect(DocsQuerySchema.parse({ due: keyword }).due).toBe(keyword);
  });

  it("accepts a calendar date for due", () => {
    expect(DocsQuerySchema.parse({ due: "2026-08-01" }).due).toBe("2026-08-01");
  });

  /**
   * `since` compares against `updated` and `due` against a deadline: keeping
   * them different types is what stops a client passing a relative keyword to
   * the absolute filter.
   */
  it.each(DUE_KEYWORDS)("rejects the due keyword %s passed to since", (keyword) => {
    expect(DocsQuerySchema.safeParse({ since: keyword }).success).toBe(false);
  });

  it("rejects a calendar date for since, which is an instant", () => {
    expect(DocsQuerySchema.safeParse({ since: "2026-08-01" }).success).toBe(false);
  });

  it("rejects a non-id for parent and references", () => {
    expect(DocsQuerySchema.safeParse({ parent: "finance" }).success).toBe(false);
    expect(DocsQuerySchema.safeParse({ references: "finance" }).success).toBe(false);
  });
});

/**
 * SPEC.md §11's search overlay offers relevance ordering only alongside a query.
 * Falling back silently would show a list ordered by something the user did not
 * ask for and could not see; a declared `400` is the honest answer.
 */
describe("sort=relevance requires a query", () => {
  it("rejects relevance without q, naming the constraint", () => {
    const result = DocsQuerySchema.safeParse({ sort: "relevance" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("relevance");
    expect(result.error?.issues[0]?.path).toEqual(["sort"]);
  });

  it("does not silently fall back to the default sort", () => {
    expect(DocsQuerySchema.safeParse({ sort: "relevance" }).data).toBeUndefined();
  });

  it("accepts relevance with q", () => {
    expect(DocsQuerySchema.parse({ sort: "relevance", q: "mortgage" }).sort).toBe("relevance");
  });

  it.each(DOC_SORTS.filter((sort) => sort !== "relevance"))(
    "accepts sort=%s without a query",
    (sort) => {
      expect(DocsQuerySchema.parse({ sort }).sort).toBe(sort);
    },
  );
});

describe("filter vocabularies", () => {
  it.each(STALE_TIERS)("recognises the staleness tier %s", (tier) => {
    expect(StaleTierSchema.parse(tier)).toBe(tier);
  });

  it("does not treat `fresh` as a tier — it is the absence of one", () => {
    expect(StaleTierSchema.safeParse("fresh").success).toBe(false);
  });

  it.each(NEEDS_FILTERS)("recognises the needs filter %s", (filter) => {
    expect(NeedsFilterSchema.parse(filter)).toBe(filter);
  });

  it.each(NEEDS_REASONS)("recognises the attention reason %s", (reason) => {
    expect(NeedsReasonSchema.parse(reason)).toBe(reason);
  });

  it("keeps `me` out of the row-level reasons: it is the union, not a reason", () => {
    expect(NeedsReasonSchema.safeParse("me").success).toBe(false);
    expect([...NEEDS_FILTERS]).toEqual(["me", ...NEEDS_REASONS]);
  });

  it.each(DOC_SORTS)("recognises the sort key %s", (sort) => {
    expect(DocSortSchema.parse(sort)).toBe(sort);
  });

  it.each(DUE_KEYWORDS)("recognises the due keyword %s", (keyword) => {
    expect(DueKeywordSchema.parse(keyword)).toBe(keyword);
  });

  it.each(SNIPPET_FIELDS)("recognises the snippet field %s", (field) => {
    expect(SnippetFieldSchema.parse(field)).toBe(field);
  });
});

describe("Snippet", () => {
  it("round-trips a title snippet as alternating matched segments", () => {
    const snippet = {
      field: "title",
      segments: [
        { text: "Mortgage ", match: false },
        { text: "options", match: true },
      ],
    };
    expect(SnippetSchema.parse(snippet)).toEqual(snippet);
  });

  it("round-trips a turn snippet, which names the thread it came from", () => {
    const snippet = {
      field: "turn",
      threadId: "th_x9y8",
      segments: [{ text: "6.1%", match: true }],
    };
    expect(SnippetSchema.parse(snippet)).toEqual(snippet);
  });

  it("leaves threadId absent on a non-turn snippet rather than inventing one", () => {
    const parsed = SnippetSchema.parse({ field: "body", segments: [] });
    expect("threadId" in parsed).toBe(false);
  });

  it("rejects a document id where a thread id belongs", () => {
    const snippet = { field: "turn", threadId: "doc_a1b2c3", segments: [] };
    expect(SnippetSchema.safeParse(snippet).success).toBe(false);
  });

  it("rejects a field outside the indexed set", () => {
    expect(SnippetSchema.safeParse({ field: "tags", segments: [] }).success).toBe(false);
  });

  /** Highlights are structured, never markup: nothing here is HTML the UI would have to trust. */
  it("keeps segments plain text with a boolean flag, not marked-up strings", () => {
    const parsed = SnippetSchema.parse({
      field: "body",
      segments: [{ text: "<b>not markup</b>", match: true }],
    });
    expect(parsed.segments[0]?.text).toBe("<b>not markup</b>");
    expect(parsed.segments[0]?.match).toBe(true);
  });
});

describe("DocRow", () => {
  it("round-trips a row with snippets and attention reasons", () => {
    const enriched = {
      ...row,
      attention: ["unread-reply", "due"],
      snippets: [
        {
          field: "title",
          segments: [
            { text: "Mortgage ", match: false },
            { text: "options", match: true },
          ],
        },
        { field: "turn", threadId: "th_x9y8", segments: [{ text: "6.1%", match: true }] },
      ],
    };
    expect(DocRowSchema.parse(enriched)).toEqual(enriched);
  });

  it.each([
    ["attention", { attention: undefined }],
    ["snippets", { snippets: undefined }],
  ])("requires %s — an empty array is valid, undefined is not", (_label, override) => {
    expect(DocRowSchema.safeParse({ ...row, ...override }).success).toBe(false);
    expect(DocRowSchema.parse(row)).toEqual(row);
  });

  it("rejects `me` as a row-level attention reason", () => {
    expect(DocRowSchema.safeParse({ ...row, attention: ["me"] }).success).toBe(false);
  });

  it("carries a thread row, since threads are documents", () => {
    const thread = { ...row, id: "th_x9y8", type: "thread" };
    expect(DocRowSchema.parse(thread).id).toBe("th_x9y8");
  });
});

describe("DocList", () => {
  it("round-trips a page of rows with its meta", () => {
    const list = { items: [row], page: { total: 1, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });

  it("round-trips an empty page", () => {
    const list = { items: [], page: { total: 0, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });
});
