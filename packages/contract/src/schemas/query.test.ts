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
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
  stale: null,
  parent: null,
  parentTitle: null,
  agent: null,
  anchorQuote: null,
  turnCount: null,
  lastAuthor: null,
  lastTurn: null,
  unread: null,
  awaitingAgent: null,
  attention: [],
  snippets: [],
};

/** The same row as a thread: every thread-only field populated (SPEC.md §11). */
const threadRow = {
  ...row,
  id: "th_x9y8",
  type: "thread",
  title: "Re: 30-year fixed assumption",
  path: "data/threads/th_x9y8.md",
  stale: "aging",
  parent: "doc_a1b2c3",
  parentTitle: "Mortgage options",
  agent: "engaged",
  anchorQuote: "assume a 30-year fixed at 6.1%",
  turnCount: 3,
  lastAuthor: "agent",
  lastTurn: "Rechecked against the October rate sheet.",
  unread: true,
  awaitingAgent: false,
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

  it.each([
    ["true", true],
    ["false", false],
  ])("reads pinned=%s as the boolean it spells", (raw, expected) => {
    expect(DocsQuerySchema.parse({ pinned: raw }).pinned).toBe(expected);
  });

  it.each(["maybe", ""])("rejects pinned=%s rather than coercing it", (raw) => {
    expect(DocsQuerySchema.safeParse({ pinned: raw }).success).toBe(false);
  });

  /** The board's one column-set query (SPEC.md §11; sprint-009 TEST-2). */
  it("composes the board query: pinned views sorted by order", () => {
    expect(DocsQuerySchema.parse({ pinned: "true", type: "view", sort: "order" })).toEqual({
      pinned: true,
      type: "view",
      sort: "order",
      limit: 50,
      offset: 0,
    });
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
    expect(DocRowSchema.parse(threadRow)).toEqual(threadRow);
  });

  it.each([
    "stale",
    "parent",
    "parentTitle",
    "agent",
    "anchorQuote",
    "turnCount",
    "lastAuthor",
    "lastTurn",
    "unread",
    "awaitingAgent",
    "order",
    "query",
    "column",
  ])("carries %s as null on a non-thread row rather than omitting it", (field) => {
    expect(DocRowSchema.parse(row)).toHaveProperty(field, null);
    const { [field]: _dropped, ...without } = row as Record<string, unknown>;
    expect(DocRowSchema.safeParse(without).success).toBe(false);
  });

  it.each(STALE_TIERS)("round-trips the %s staleness tier", (tier) => {
    expect(DocRowSchema.parse({ ...row, stale: tier }).stale).toBe(tier);
  });

  it("has no `fresh` tier — freshness is the absence of one", () => {
    expect(DocRowSchema.safeParse({ ...row, stale: "fresh" }).success).toBe(false);
    expect(DocRowSchema.parse({ ...row, stale: null }).stale).toBeNull();
  });

  it("accepts a document whose timestamps are unknown, without inventing an epoch", () => {
    const undated = { ...row, created: null, updated: null };
    expect(DocRowSchema.parse(undated)).toEqual(undated);
  });

  it("still rejects a malformed timestamp — nullable is not lenient", () => {
    expect(DocRowSchema.safeParse({ ...row, updated: "yesterday" }).success).toBe(false);
  });

  it("rejects an agent state outside the thread vocabulary", () => {
    expect(DocRowSchema.safeParse({ ...threadRow, agent: "thinking" }).success).toBe(false);
  });

  it("rejects a negative turn count", () => {
    expect(DocRowSchema.safeParse({ ...threadRow, turnCount: -1 }).success).toBe(false);
  });

  /**
   * CONTRACT-011: the row carries the whole §11 view surface, so one
   * `pinned=true&type=view&sort=order` query is the entire column set — no
   * per-view `GET /api/docs/{id}` follow-up (sprint-009 TEST-2).
   */
  it("carries a pinned view row with its query, order and extra", () => {
    const viewRow = {
      ...row,
      id: "doc_seedattention",
      type: "view",
      title: "Attention",
      pinned: true,
      order: 1,
      query: { needs: "me" },
      extra: { boardIcon: "🔔" },
    };
    expect(DocRowSchema.parse(viewRow)).toEqual(viewRow);
  });

  it.each([
    ["pinned", { pinned: undefined }],
    ["extra", { extra: undefined }],
  ])("requires %s — the absent-on-disk reading is false/{}, not a missing key", (_l, override) => {
    expect(DocRowSchema.safeParse({ ...row, ...override }).success).toBe(false);
  });

  it("rejects a core key inside a row's extra — shadowing is impossible on reads too", () => {
    expect(DocRowSchema.safeParse({ ...row, extra: { id: "doc_other" } }).success).toBe(false);
  });

  it("carries the parent's live title on a thread row, mirroring Job.originTitle", () => {
    expect(DocRowSchema.parse(threadRow).parentTitle).toBe("Mortgage options");
  });
});

describe("DocList", () => {
  it("round-trips a page of rows with its meta", () => {
    const list = { items: [row], page: { total: 1, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });

  it("round-trips a page mixing a document row and a thread row", () => {
    const list = { items: [row, threadRow], page: { total: 2, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });

  it("round-trips an empty page", () => {
    const list = { items: [], page: { total: 0, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });
});
