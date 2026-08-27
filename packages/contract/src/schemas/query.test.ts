import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CreateDocRequestSchema } from "./doc.js";
import {
  collectExtraFilters,
  DEFAULT_DOC_SORT,
  DOC_SORTS,
  DUE_KEYWORDS,
  DocListSchema,
  DocRowSchema,
  DocsQuerySchema,
  DocSortSchema,
  DueKeywordSchema,
  EXTRA_KEY_PATTERN,
  EXTRA_PARAM_PREFIX,
  FOLDER_SCOPES,
  hasGlob,
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
  stage: null,
  tags: ["finance"],
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  due: "2026-08-01",
  reviewed: "2026-07-20T09:00:00Z",
  evergreen: false,
  origin: null,
  lastActor: "user",
  excerpt: "Body is plain markdown.",
  order: null,
  query: null,
  columns: null,
  kanban: null,
  defaultOpen: false,
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
  unreadThreads: 0,
  unansweredForms: 0,
  attention: [],
  snippets: [],
};

/** The same row as a thread: every thread-only field populated (SPEC.md §10). */
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
  unansweredForms: 2,
  attention: ["form" as const],
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

  /** SPEC.md §12's M6: a document of a type this build never heard of is searchable like any other. */
  it("leaves `type` open, so an unrecognised type can still be filtered on", () => {
    expect(DocsQuerySchema.parse({ type: "ledger" }).type).toBe("ledger");
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

  /**
   * Rider 7 removed `pinned` from the API on 2026-08-22, and the strict-bodies,
   * tolerant-reads policy means a query is *tolerant*: a client still sending
   * it is answered rather than refused, with the parameter dropped. Pinned so
   * the tolerance is a recorded decision rather than a discovery.
   */
  it("no longer accepts `pinned`, and strips it rather than refusing the read", () => {
    const parsed = DocsQuerySchema.parse({ pinned: "true", type: "view" });
    expect("pinned" in parsed).toBe(false);
    expect(parsed.type).toBe("view");
  });

  /**
   * CONTRACT-012 rider. The archived chip wants "these *as well as* the rest",
   * which `status` cannot spell: it takes one lifecycle value, so
   * `status=archived` is archived-only. `includeArchived` lifts the default
   * exclusion instead of replacing the filter.
   */
  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads includeArchived=%s as the boolean it spells", (raw, expected) => {
    expect(DocsQuerySchema.parse({ includeArchived: raw }).includeArchived).toBe(expected);
  });

  it.each(["maybe", ""])("rejects includeArchived=%s rather than coercing it", (raw) => {
    expect(DocsQuerySchema.safeParse({ includeArchived: raw }).success).toBe(false);
  });

  it("leaves includeArchived absent rather than defaulting it, so the server owns the default", () => {
    expect("includeArchived" in DocsQuerySchema.parse({})).toBe(false);
  });

  it("composes includeArchived with a status, which the server resolves in status's favour", () => {
    expect(DocsQuerySchema.parse({ status: "open", includeArchived: "true" })).toMatchObject({
      status: "open",
      includeArchived: true,
    });
  });

  /**
   * CONTRACT-042. `isParent` reads the same wire vocabulary as `pinned`,
   * `unread` and `includeArchived` — one boolean convention on this endpoint,
   * not two.
   */
  it.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads isParent=%s as the boolean it spells", (raw, expected) => {
    expect(DocsQuerySchema.parse({ isParent: raw }).isParent).toBe(expected);
  });

  it.each(["maybe", "", "root"])("rejects isParent=%s rather than coercing it", (raw) => {
    expect(DocsQuerySchema.safeParse({ isParent: raw }).success).toBe(false);
  });

  it("leaves isParent absent rather than defaulting it to true", () => {
    expect("isParent" in DocsQuerySchema.parse({})).toBe(false);
  });

  /** The board bar's one query (SPEC.md §10, rider 2 — `order` is now a board's). */
  it("composes the board-bar query: boards sorted by order", () => {
    expect(DocsQuerySchema.parse({ type: "board", sort: "order" })).toEqual({
      type: "board",
      sort: "order",
      limit: 50,
      offset: 0,
    });
  });

  /**
   * CONTRACT-074's null sentinel. A kanban's first column holds its first stage
   * *and* everything unstaged (SPEC.md §10), so the empty element is what makes
   * it one request instead of two responses ORed in the client.
   */
  describe("the stage filter's null sentinel", () => {
    it("accepts a single stage", () => {
      expect(DocsQuerySchema.parse({ stage: "review" }).stage).toBe("review");
    });

    it("accepts a kanban's first column in one request: the sentinel ORed with a stage", () => {
      expect(DocsQuerySchema.parse({ stage: ",triage" }).stage).toBe(",triage");
    });

    it("accepts the bare sentinel, which selects the unstaged alone", () => {
      expect(DocsQuerySchema.parse({ stage: "" }).stage).toBe("");
    });

    it("leaves stage absent when it is not sent, so nothing is filtered", () => {
      expect("stage" in DocsQuerySchema.parse({})).toBe(false);
    });

    /**
     * The whole reason the sentinel is the empty element rather than a word:
     * a written stage is a non-empty string, so the empty element names a value
     * no document can hold and can never collide with a real one.
     */
    it("cannot collide, because a written stage is never empty", () => {
      expect(
        CreateDocRequestSchema.safeParse({ type: "note", title: "t", stage: "" }).success,
      ).toBe(false);
    });
  });
});

/**
 * SPEC.md §10's search overlay offers relevance ordering only alongside a query.
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

/**
 * CONTRACT-042. `parent=<id>` names a parent and `isParent=true` demands there
 * be none. The refusal is deliberate and not a fallout of composition: because
 * `parent` no-ops for non-thread types, intersecting the two would answer with
 * every root non-thread document rather than with nothing.
 */
describe("parent and isParent=true are refused together", () => {
  it("rejects the contradiction, naming both parameters", () => {
    const result = DocsQuerySchema.safeParse({ parent: "doc_a1b2c3", isParent: "true" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("`parent=<id>` and `isParent=true`");
    expect(result.error?.issues[0]?.path).toEqual(["isParent"]);
  });

  it("does not answer an empty set, which would be indistinguishable from a real one", () => {
    expect(
      DocsQuerySchema.safeParse({ parent: "doc_a1b2c3", isParent: "true" }).data,
    ).toBeUndefined();
  });

  it("accepts the redundant-but-consistent pairing with isParent=false", () => {
    expect(DocsQuerySchema.parse({ parent: "doc_a1b2c3", isParent: "false" })).toMatchObject({
      parent: "doc_a1b2c3",
      isParent: false,
    });
  });

  it.each([
    ["parent alone", { parent: "doc_a1b2c3" }],
    ["isParent alone", { isParent: "true" }],
    ["isParent with an unrelated filter", { isParent: "true", type: "note" }],
  ])("accepts %s", (_label, query) => {
    expect(DocsQuerySchema.safeParse(query).success).toBe(true);
  });
});

/**
 * CONTRACT-081. `folderScope` modifies `folder`; it selects nothing on its own.
 * The tests below hold three things a reading of the schema cannot: that the
 * absent parameter stays absent (so today's callers keep today's set), that the
 * scope alone is refused rather than answered over the corpus, and that the
 * refusal covers `tree` as well as `self`.
 */
describe("the folderScope modifier", () => {
  it.each(FOLDER_SCOPES)("accepts folderScope=%s alongside a folder", (scope) => {
    expect(DocsQuerySchema.parse({ folder: "finance", folderScope: scope })).toMatchObject({
      folder: "finance",
      folderScope: scope,
    });
  });

  it("rejects a scope it does not define, rather than falling back to the tree", () => {
    expect(DocsQuerySchema.safeParse({ folder: "finance", folderScope: "recursive" }).success).toBe(
      false,
    );
  });

  /**
   * The default is `tree`, and it is **not** applied by the schema: a zod
   * default would run before the refinement and make a sent scope
   * indistinguishable from an absent one. Absent means `tree` to the server,
   * and the published parameter carries `default: "tree"` to say so.
   */
  it("leaves folderScope absent rather than materialising the default", () => {
    expect("folderScope" in DocsQuerySchema.parse({ folder: "finance" })).toBe(false);
  });

  it("keeps a folder-only query exactly as it was before this parameter existed", () => {
    expect(DocsQuerySchema.parse({ folder: "finance" })).toEqual({
      folder: "finance",
      limit: 50,
      offset: 0,
      sort: DEFAULT_DOC_SORT,
    });
  });

  it.each(FOLDER_SCOPES)("refuses folderScope=%s with no folder, naming folder", (scope) => {
    const result = DocsQuerySchema.safeParse({ folderScope: scope });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("`folder`");
    expect(result.error?.issues[0]?.path).toEqual(["folderScope"]);
  });

  it("does not answer the unscoped corpus to a request that asked for one folder", () => {
    expect(DocsQuerySchema.safeParse({ folderScope: "self" }).data).toBeUndefined();
  });

  it("composes with the rest of the grammar", () => {
    expect(
      DocsQuerySchema.parse({
        folder: "finance",
        folderScope: "self",
        type: "note",
        isParent: "true",
        sort: "title",
      }),
    ).toMatchObject({ folder: "finance", folderScope: "self", type: "note", isParent: true });
  });
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
   * CONTRACT-011, widened by CONTRACT-074: the row carries the whole §10 view
   * *and board* surface, so one `type=board&sort=order` query is the whole
   * board bar and one `type=view` query is every column definition — no
   * per-document `GET /api/docs/{id}` follow-up (sprint-009 TEST-2).
   */
  it("carries a view row with its query and extra", () => {
    const viewRow = {
      ...row,
      id: "doc_seedattention",
      type: "view",
      title: "Attention",
      query: { needs: "me" },
      extra: { boardIcon: "🔔" },
    };
    expect(DocRowSchema.parse(viewRow)).toEqual(viewRow);
  });

  it("carries a board row with its columns, its position and its default-open flag", () => {
    const boardRow = {
      ...row,
      id: "doc_seedboard",
      type: "board",
      title: "Everything",
      order: 1,
      columns: ["doc_seedattention", "doc_seedinbox"],
      defaultOpen: true,
    };
    expect(DocRowSchema.parse(boardRow)).toEqual(boardRow);
  });

  it("carries a kanban board row with its whole definition, graph and status map", () => {
    const kanbanRow = {
      ...row,
      id: "doc_seedpipeline",
      type: "board",
      title: "Pipeline",
      order: 2,
      query: { tag: "deal" },
      kanban: {
        field: "stage",
        stages: ["triage", "drafting", "done"],
        transitions: { triage: ["drafting"], drafting: ["done"] },
        status: { done: "resolved" },
      },
    };
    expect(DocRowSchema.parse(kanbanRow)).toEqual(kanbanRow);
  });

  /** §7's reflection reads this off the row; it is never absent and never null. */
  it("carries the acting party of the last write, and requires it", () => {
    expect(DocRowSchema.parse({ ...row, lastActor: "agent" }).lastActor).toBe("agent");
    expect(DocRowSchema.safeParse({ ...row, lastActor: undefined }).success).toBe(false);
    expect(DocRowSchema.safeParse({ ...row, lastActor: null }).success).toBe(false);
  });

  it.each([
    ["stage", { stage: undefined }],
    ["columns", { columns: undefined }],
    ["kanban", { kanban: undefined }],
    ["defaultOpen", { defaultOpen: undefined }],
    ["extra", { extra: undefined }],
  ])(
    "requires %s — the absent-on-disk reading is false/null/{}, not a missing key",
    (_l, override) => {
      expect(DocRowSchema.safeParse({ ...row, ...override }).success).toBe(false);
    },
  );

  it("rejects a core key inside a row's extra — shadowing is impossible on reads too", () => {
    expect(DocRowSchema.safeParse({ ...row, extra: { id: "doc_other" } }).success).toBe(false);
  });

  it("carries the parent's live title on a thread row, mirroring Job.originTitle", () => {
    expect(DocRowSchema.parse(threadRow).parentTitle).toBe("Mortgage options");
  });

  /**
   * CONTRACT-012 rider. An orphaned thread keeps its `parent` and loses its
   * `parentTitle`; the kit's `rowContext` returns null for it and the row
   * renders an empty context cell. "Standalone" is a different state — no
   * `parent` at all — and the description used to conflate the two.
   */
  it("keeps an orphaned thread distinguishable from a standalone one", () => {
    const orphaned = DocRowSchema.parse({ ...threadRow, parentTitle: null });
    expect(orphaned.parent).toBe("doc_a1b2c3");
    expect(orphaned.parentTitle).toBeNull();

    const standalone = DocRowSchema.parse({ ...threadRow, parent: null, parentTitle: null });
    expect(standalone.parent).toBeNull();
  });

  it("does not tell a reader to render an orphaned thread as standalone", () => {
    const description = DocRowSchema.shape.parentTitle.description ?? "";
    expect(description).toContain("current title of whatever `parent` names");
    expect(description).toContain("never a stored copy");
    expect(description).toContain("empty");
    expect(description).not.toContain("render such a thread as standalone");
  });
});

/**
 * CONTRACT-012. The aggregate exists so a document row can render its unread
 * pill from the collection response alone; the per-row
 * `?parent=<id>&type=thread&unread=true` it replaces is the N+1 sprint-009
 * TEST-66 forbids by name.
 */
describe("DocRow.unreadThreads", () => {
  it("carries a document's unread thread count", () => {
    expect(DocRowSchema.parse({ ...row, unreadThreads: 3 }).unreadThreads).toBe(3);
  });

  /** `0` is a count, not a stand-in for "unknown" — hence required, not nullable. */
  it("requires the count: absent and null are both invalid, 0 is the empty answer", () => {
    const { unreadThreads: _dropped, ...without } = row;
    expect(DocRowSchema.safeParse(without).success).toBe(false);
    expect(DocRowSchema.safeParse({ ...row, unreadThreads: null }).success).toBe(false);
    expect(DocRowSchema.parse({ ...row, unreadThreads: 0 }).unreadThreads).toBe(0);
  });

  it("is 0 rather than null on a thread row, which aggregates nothing here", () => {
    expect(DocRowSchema.parse(threadRow).unreadThreads).toBe(0);
    expect(DocRowSchema.safeParse({ ...threadRow, unreadThreads: null }).success).toBe(false);
  });

  it.each([-1, 1.5, "2"])("rejects %s — it is a non-negative integer count", (value) => {
    expect(DocRowSchema.safeParse({ ...row, unreadThreads: value }).success).toBe(false);
  });

  /**
   * The description IS the contract for the server half (SERVER-027) and for
   * the kit's pill: a reader who only sees the generated document has to learn
   * the thread-row case and the "0 is not unknown" rule from it.
   */
  it("publishes the semantics the server and the pill both depend on", () => {
    const description = DocRowSchema.shape.unreadThreads.description ?? "";
    expect(description).toContain("SPEC.md §7");
    expect(description).toContain("?parent=<id>&type=thread&unread=true");
    expect(description).toContain("`0` on a thread row");
    expect(description).toContain("no threads");
    expect(description).toContain('"unknown"');
  });
});

/**
 * CONTRACT-040. §10's Attention sentence ends "a thread holding **more than
 * one** unanswered form says how many are still open", and `attention` is a list
 * of bare codes carrying no number — so the count is a field of its own or the
 * clause is unimplementable without an N+1 per row.
 */
describe("DocRow.unansweredForms", () => {
  it("carries a thread's open-form count", () => {
    expect(DocRowSchema.parse({ ...threadRow, unansweredForms: 3 }).unansweredForms).toBe(3);
  });

  /** `0` is a count, not a stand-in for "unknown" — hence required, not nullable. */
  it("requires the count: absent and null are both invalid, 0 is the empty answer", () => {
    const { unansweredForms: _dropped, ...without } = row;
    expect(DocRowSchema.safeParse(without).success).toBe(false);
    expect(DocRowSchema.safeParse({ ...row, unansweredForms: null }).success).toBe(false);
    expect(DocRowSchema.parse({ ...row, unansweredForms: 0 }).unansweredForms).toBe(0);
  });

  /**
   * The departure from `threadRowShape`'s nullable convention, pinned: the chip
   * reads this through a `> 1` threshold, and `null > 1` is silently `false`.
   */
  it("is 0 rather than null on a non-thread row, which holds no forms", () => {
    expect(DocRowSchema.parse(row).unansweredForms).toBe(0);
    expect(DocRowSchema.safeParse({ ...row, unansweredForms: null }).success).toBe(false);
  });

  it.each([-1, 1.5, "2"])("rejects %s — it is a non-negative integer count", (value) => {
    expect(DocRowSchema.safeParse({ ...row, unansweredForms: value }).success).toBe(false);
  });

  /**
   * The invariant the field exists to keep, asserted **in both directions** on
   * the two fixtures — a claim that holds one way is the review finding this
   * package collected twice this week. The server derives both from one query;
   * these two assertions are what a fixture that stopped agreeing would trip.
   */
  it("keeps count and reason in step both ways on the fixtures it publishes", () => {
    const parsed = [row, threadRow].map((item) => DocRowSchema.parse(item));
    for (const item of parsed) {
      expect(item.unansweredForms > 0).toBe(item.attention.includes("form"));
    }
    expect(parsed.map((item) => item.unansweredForms > 0)).toEqual([false, true]);
  });

  /**
   * The description IS the contract for the server half and for the kit's chip:
   * a reader who only sees the generated document has to learn the equivalence,
   * its direction, the resolve rule, the seen asymmetry and "0 is not unknown"
   * from it.
   */
  it("publishes the semantics the server and the chip both depend on", () => {
    const description = DocRowSchema.shape.unansweredForms.description ?? "";
    expect(description).toContain("SPEC.md §6, §10");
    expect(description).toContain("both directions");
    expect(description).toContain("iff");
    expect(description).toContain("`needs=form`");
    expect(description).toContain("Resolving the thread takes it to `0`");
    expect(description).toContain("seen");
    expect(description).toContain("non-thread row");
    expect(description).toContain('"unknown"');
    expect(description).toContain("greater than one");
  });

  /** The count is a sibling of the reason list, never a widening of its entries. */
  it("leaves `attention` a list of bare codes", () => {
    expect(DocRowSchema.parse(threadRow).attention).toEqual(["form"]);
    expect(
      DocRowSchema.safeParse({ ...threadRow, attention: [{ code: "form", count: 2 }] }).success,
    ).toBe(false);
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

/**
 * SPEC.md §5's **Structured fields** and §9.2's **Pattern matching** — the rider
 * signed 2026-08-04 (SHARED-011), on the wire.
 */

/** `collectExtraFilters`, with its `ZodError` unpacked into readable issues. */
function safeCollect(raw: Record<string, string>): {
  ok: boolean;
  issues?: { path: PropertyKey[]; message: string }[];
} {
  try {
    collectExtraFilters(raw);
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        issues: error.issues.map((issue) => ({ path: [...issue.path], message: issue.message })),
      };
    }
    throw error;
  }
}

describe("structured fields and glob patterns", () => {
  it("puts `title` and `body` on the shape, and rejects the empty string like `q`", () => {
    expect(DocsQuerySchema.parse({ title: "Catch-Up*" }).title).toBe("Catch-Up*");
    expect(DocsQuerySchema.parse({ body: "rate assumption" }).body).toBe("rate assumption");
    expect(DocsQuerySchema.safeParse({ title: "" }).success).toBe(false);
    expect(DocsQuerySchema.safeParse({ body: "" }).success).toBe(false);
  });

  /**
   * `apps/ui/src/board/query/grammar.ts` derives the query editor's field list
   * from this shape at runtime, so a filter that is not here is a filter the
   * editor calls unknown.
   */
  it("keeps `.shape` enumerable, with the three new names in it", () => {
    const names = Object.keys(DocsQuerySchema.shape);
    expect(names).toContain("title");
    expect(names).toContain("body");
    expect(names).toContain("extra");
  });

  it.each([
    ["Catch-Up*", true],
    ["who?", true],
    ["finance", false],
    ["", false],
  ])("reads %s as a pattern: %s", (value, expected) => {
    expect(hasGlob(value)).toBe(expected);
  });

  describe("collectExtraFilters", () => {
    it("lifts the dotted parameters and leaves every other one alone", () => {
      expect(collectExtraFilters({ type: "note", "extra.assignee": "theo" })).toEqual({
        assignee: "theo",
      });
    });

    it("answers undefined when no parameter opens the namespace", () => {
      expect(collectExtraFilters({ type: "note", tag: "finance" })).toBeUndefined();
    });

    it("collects several keys, which AND together downstream", () => {
      expect(collectExtraFilters({ "extra.assignee": "theo", "extra.customer": "acme" })).toEqual({
        assignee: "theo",
        customer: "acme",
      });
    });

    it("refuses a key that is not an identifier, naming it", () => {
      const result = safeCollect({ "extra.1x": "y", 'extra.a"b': "x" });
      expect(result.ok).toBe(false);
      // The offending parameter, so a caller who mistyped one of several sees
      // which — a record's own key failure says only "Invalid key in record".
      expect(result.issues?.[0]?.path).toEqual(["extra.1x"]);
      expect(result.issues?.[0]?.message).toContain("identifier");
      expect(result.issues?.[0]?.message).toContain("extra.1x");
    });

    it("names the parameter when a value is missing, and says absence is not askable", () => {
      const result = safeCollect({ "extra.assignee": "" });
      expect(result.issues?.[0]?.path).toEqual(["extra.assignee"]);
      expect(result.issues?.[0]?.message).toContain("absence");
    });

    it("refuses the empty key", () => {
      expect(() => collectExtraFilters({ [EXTRA_PARAM_PREFIX]: "x" })).toThrow();
    });

    /**
     * There is no absence sentinel, deliberately: `stage=`'s empty element is a
     * core field's null sentinel and an open namespace does not get a second one.
     */
    it("refuses an empty value rather than reading it as absence", () => {
      expect(() => collectExtraFilters({ "extra.assignee": "" })).toThrow();
    });

    it("takes a value carrying a glob, which is the field's own business", () => {
      expect(collectExtraFilters({ "extra.assignee": "t*" })).toEqual({ assignee: "t*" });
    });
  });

  it("refuses a key that is not an identifier through the schema too", () => {
    expect(DocsQuerySchema.safeParse({ extra: { "a.b": "x" } }).success).toBe(false);
    expect(DocsQuerySchema.safeParse({ extra: { assignee: "theo" } }).success).toBe(true);
  });

  it.each(["owner", "_x", "a-b", "A1"])("accepts %s as a key", (key) => {
    expect(EXTRA_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(["1x", "a b", "a.b", "", 'a"b'])("refuses %s as a key", (key) => {
    expect(EXTRA_KEY_PATTERN.test(key)).toBe(false);
  });

  /**
   * `folderScope=self` measures a literal prefix length, which a pattern does
   * not have. Refused rather than answered with a plausible-looking list — the
   * same rule `parent` + `isParent=true` is refused under.
   */
  it("refuses `folderScope` alongside a glob `folder`", () => {
    expect(DocsQuerySchema.safeParse({ folder: "work/*", folderScope: "self" }).success).toBe(
      false,
    );
    expect(DocsQuerySchema.safeParse({ folder: "work", folderScope: "self" }).success).toBe(true);
    // Without a scope, a pattern is perfectly ordinary.
    expect(DocsQuerySchema.safeParse({ folder: "work/*" }).success).toBe(true);
  });
});
