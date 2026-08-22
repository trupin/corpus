import { describe, expect, it } from "vitest";
import {
  CORE_DOC_TYPES,
  CoreDocTypeSchema,
  CreateDocRequestSchema,
  DeleteDocResultSchema,
  DocFrontmatterSchema,
  DocMutationResponseSchema,
  DocSchema,
  DocStatusSchema,
  MoveDocRequestSchema,
  UpdateDocRequestSchema,
  UpdateDocResponseSchema,
  docRowBaseShape,
} from "./doc.js";

/** A key as the wire carries one: 64 lowercase hex characters, and opaque. */
const DOC_KEY = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde";

const frontmatter = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  tags: ["finance"],
  status: "open",
  anchors: {
    anc_k4f7: {
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "the model we ",
      suffix: " which may be stale",
    },
  },
  due: null,
  reviewed: null,
  evergreen: false,
  origin: null,
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
};

/**
 * The seed `attention.md` view document (assets/workspace), as the wire carries
 * it — the frontmatter CONTRACT-011's surface exists to round-trip.
 */
const viewFrontmatter = {
  ...frontmatter,
  id: "doc_seedattention",
  type: "view",
  title: "Attention",
  evergreen: true,
  origin: null,
  pinned: true,
  order: 1,
  query: { needs: "me" },
};

const doc = {
  frontmatter,
  body: "Body is plain markdown.",
  path: "data/docs/finance/mortgage-options.md",
  anchors: [
    {
      anchorId: "anc_k4f7",
      selector: { exact: "assume a 30-year fixed at 6.1%", prefix: "the model we ", suffix: "" },
      threadId: "th_x9y8",
      threadStatus: "open",
      range: { start: 42, end: 71 },
      orphaned: false,
    },
  ],
  key: DOC_KEY,
  userEditing: false,
};

describe("DocFrontmatter", () => {
  it("round-trips the SPEC.md §5 canonical frontmatter", () => {
    expect(DocFrontmatterSchema.parse(frontmatter)).toEqual(frontmatter);
  });

  /** SPEC.md §12's M6: a type this build never heard of parses like any other. */
  it("accepts an unrecognised type, since the core's six are not all there are", () => {
    expect(DocFrontmatterSchema.parse({ ...frontmatter, type: "ledger" }).type).toBe("ledger");
  });

  it("rejects a status outside the lifecycle", () => {
    expect(DocFrontmatterSchema.safeParse({ ...frontmatter, status: "done" }).success).toBe(false);
  });

  it("rejects an anchor key that is not an anchor id", () => {
    const broken = { ...frontmatter, anchors: { k4f7: { exact: "x", prefix: "", suffix: "" } } };
    expect(DocFrontmatterSchema.safeParse(broken).success).toBe(false);
  });

  /**
   * The hand-written `SKILL.md` of SPEC.md §7: no frontmatter timestamps at all.
   * `GET /api/docs` says `null` for it (`docRowBaseShape`), so `GET /api/docs/{id}`
   * must say `null` too — the epoch sentinel the server used to substitute made
   * the same file read two different ages depending on the route.
   */
  it("round-trips an undated document, the same way the list row does", () => {
    const undated = { ...frontmatter, created: null, updated: null };
    expect(DocFrontmatterSchema.parse(undated)).toEqual(undated);
  });

  it("still rejects a malformed timestamp — nullable is not lenient", () => {
    expect(DocFrontmatterSchema.safeParse({ ...frontmatter, created: "yesterday" }).success).toBe(
      false,
    );
  });

  it("still requires the timestamp keys to be present", () => {
    const { created: _created, ...withoutCreated } = frontmatter;
    expect(DocFrontmatterSchema.safeParse(withoutCreated).success).toBe(false);
  });

  it.each(["created", "updated"] as const)(
    "tells the client to render %s as an em dash rather than substituting a date",
    (field) => {
      const description = DocFrontmatterSchema.shape[field].meta()?.description ?? "";
      expect(description).toContain("—");
      expect(description).toContain("staleness treats an unknown age as fresh");
    },
  );

  /**
   * The bug this closes: the two response-side shapes described the same two
   * fields differently, so a consumer reading one route learned the wrong rule.
   */
  it.each(["created", "updated"] as const)(
    "describes %s identically to the list row, since they describe the same file",
    (field) => {
      expect(DocFrontmatterSchema.shape[field].meta()?.description).toBe(
        docRowBaseShape[field].meta()?.description,
      );
    },
  );
});

/**
 * CONTRACT-011: the §10 view keys are first-class core fields on every
 * response surface, so the board reads its whole column set — query, order,
 * column type — from the list response with no per-view follow-up read.
 */
describe("view frontmatter keys", () => {
  it("round-trips the seed attention view's frontmatter", () => {
    expect(DocFrontmatterSchema.parse(viewFrontmatter)).toEqual(viewFrontmatter);
  });

  it("round-trips a multi-filter query with an array value, as the chips render it", () => {
    const withQuery = {
      ...viewFrontmatter,
      query: { type: "thread", status: "open", tag: ["finance", "house"] },
    };
    expect(DocFrontmatterSchema.parse(withQuery)).toEqual(withQuery);
  });

  it("round-trips a view carrying a column key the core renders nothing from", () => {
    const columnView = { ...viewFrontmatter, query: null, column: "ledger/board" };
    expect(DocFrontmatterSchema.parse(columnView)).toEqual(columnView);
  });

  it.each(["pinned", "order", "query", "column", "extra"] as const)(
    "requires %s to be present — absent-on-disk is false/null/{}, never a missing key",
    (field) => {
      const { [field]: _dropped, ...without } = frontmatter as Record<string, unknown>;
      expect(DocFrontmatterSchema.safeParse(without).success).toBe(false);
    },
  );

  it.each(["pinned", "order", "query", "column", "extra"] as const)(
    "describes %s identically to the list row, since they describe the same file key",
    (field) => {
      expect(DocFrontmatterSchema.shape[field].meta()?.description).toBe(
        docRowBaseShape[field].meta()?.description,
      );
    },
  );

  it("rejects a nested object as a query value — the query is one flat level of filters", () => {
    const nested = { ...viewFrontmatter, query: { needs: { me: true } } };
    expect(DocFrontmatterSchema.safeParse(nested).success).toBe(false);
  });

  it("accepts any finite number for order, so a reorder can write midpoints", () => {
    expect(DocFrontmatterSchema.parse({ ...viewFrontmatter, order: 1.5 }).order).toBe(1.5);
  });

  it("carries extra frontmatter beside the core keys", () => {
    const withExtra = { ...frontmatter, type: "ledger", extra: { items: [{ done: false }] } };
    expect(DocFrontmatterSchema.parse(withExtra)).toEqual(withExtra);
  });

  it("rejects a core key smuggled through extra, on the read shape too", () => {
    const shadowed = { ...frontmatter, extra: { title: "shadowed" } };
    expect(DocFrontmatterSchema.safeParse(shadowed).success).toBe(false);
  });
});

describe("Doc", () => {
  it("round-trips a document with a resolved anchor", () => {
    expect(DocSchema.parse(doc)).toEqual(doc);
  });

  it("round-trips an orphaned anchor, whose range is null", () => {
    const orphaned = {
      ...doc,
      anchors: [{ ...doc.anchors[0], range: null, orphaned: true }],
    };
    expect(DocSchema.parse(orphaned)).toEqual(orphaned);
  });

  /**
   * SPEC.md §7: *every* document read carries the key naming the version it
   * returned. A read that could omit it would leave a writer with nothing to
   * present, so the only way to write would be not to have read.
   */
  it("requires the key, on every read of a whole document", () => {
    const { key: _dropped, ...keyless } = doc;
    expect(DocSchema.safeParse(keyless).success).toBe(false);
  });

  it("requires the editing signal beside it, so a read can never half-answer", () => {
    const { userEditing: _dropped, ...unsignalled } = doc;
    expect(DocSchema.safeParse(unsignalled).success).toBe(false);
  });

  it("reports a person editing without that changing anything else", () => {
    const beingEdited = { ...doc, userEditing: true };
    expect(DocSchema.parse(beingEdited)).toEqual(beingEdited);
  });

  /**
   * A list row carries no body, so there is no version of a body to have read —
   * and a key on one would let a caller write a document it never opened.
   */
  it("keeps the key off the list row", () => {
    expect(Object.keys(docRowBaseShape)).not.toContain("key");
    expect(Object.keys(docRowBaseShape)).not.toContain("userEditing");
  });
});

describe("CreateDocRequest", () => {
  /**
   * The zero-form create (SPEC.md §10). The schema deliberately does *not*
   * materialise `tags`/`status`/`due`/`evergreen` at parse time: a Zod default
   * becomes a JSON Schema `default`, which `openapi-typescript` renders as a
   * required member of the client's request type — so the caller would be forced
   * to send the very fields the server exists to fill in (CONTRACT-003).
   */
  it("leaves every server-applied field absent rather than defaulting it", () => {
    expect(CreateDocRequestSchema.parse({ type: "note", title: "Untitled" })).toEqual({
      type: "note",
      title: "Untitled",
    });
  });

  it.each(["tags", "status", "due", "evergreen"] as const)(
    "documents the server-applied default for %s, since that is where a client learns it",
    (field) => {
      const description = CreateDocRequestSchema.shape[field].meta()?.description ?? "";
      expect(description).toContain("efault");
    },
  );

  it("still accepts every optional field when the caller does supply one", () => {
    const request = {
      type: "note",
      title: "Untitled",
      tags: ["finance"],
      status: "archived" as const,
      due: "2026-08-01",
      evergreen: true,
    };
    expect(CreateDocRequestSchema.parse(request)).toEqual(request);
  });

  it("keeps an explicit null due distinguishable from an omitted one", () => {
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T", due: null }).due).toBeNull();
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T" }).due).toBeUndefined();
  });

  it("rejects an empty title", () => {
    expect(CreateDocRequestSchema.safeParse({ type: "note", title: "" }).success).toBe(false);
  });

  /**
   * The title-collision refusal `allocatePath` raises is a `400` the schema
   * cannot express — whether a name is taken is a fact about the workspace, not
   * about the value — so the description is its whole publication (PR #49
   * review). What the schema still owns is that a colliding title is **valid**:
   * the refusal comes from the server with the corpus in front of it, and a
   * client must not pre-empt it by rejecting the title locally.
   */
  it("documents that a title can be refused, and validates a colliding one anyway", () => {
    const description = CreateDocRequestSchema.shape.title.meta()?.description ?? "";
    expect(description).toContain("`400`");
    expect(description).toContain("@analyst");
    const request = { type: "agent-def", title: "Analyst", folder: ".claude/agents" };
    expect(CreateDocRequestSchema.parse(request).title).toBe("Analyst");
  });

  /**
   * The default is `inbox`, not the root: creation is inbox-first (SPEC.md §10)
   * and the server's `documentPathFor` implements it. The schema leaves `folder`
   * absent so the server owns the default — what is asserted here is that the
   * published description says so, since that is the only place a client learns it.
   */
  it("documents the inbox default and both accepted folder spellings", () => {
    const description = CreateDocRequestSchema.shape.folder.meta()?.description ?? "";
    expect(description).toContain("`inbox`");
    expect(description).toContain("data/docs/finance");
    expect(description).not.toContain("defaults to the root");
  });

  it.each(["finance", "data/docs/finance"])("accepts the folder spelling %s", (folder) => {
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T", folder }).folder).toBe(folder);
  });

  /**
   * A declared root is a third accepted spelling on create alone (SERVER-122):
   * it is not a folder under `data/docs/`, so nothing in the schema could have
   * told a caller it is legal — the description is the whole publication of it,
   * and the value passes validation unchanged either way (CONTRACT-062).
   */
  it("accepts a declared root as a folder spelling, which only create documents", () => {
    const request = { type: "agent-def", title: "Reviewer", folder: ".claude/agents" };
    expect(CreateDocRequestSchema.parse(request).folder).toBe(".claude/agents");
    expect(CreateDocRequestSchema.shape.folder.meta()?.description).toContain(".claude/agents");
  });

  it("creates a pinned view in one call — the new-list picker's shape", () => {
    const request = {
      type: "view",
      title: "Finance",
      pinned: true,
      order: 40,
      query: { folder: "finance" },
    };
    expect(CreateDocRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts extra frontmatter on create", () => {
    const request = { type: "ledger", title: "Chores", extra: { items: [] } };
    expect(CreateDocRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects a core key smuggled through extra on create", () => {
    const request = { type: "note", title: "T", extra: { status: "resolved" } };
    expect(CreateDocRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each(["ledger/board", "publish/status"])("accepts the column reference %s", (column) => {
    const request = { type: "view", title: "T", pinned: true, column };
    expect(CreateDocRequestSchema.parse(request).column).toBe(column);
  });

  it.each(["ledger", "ledger/", "/board", "ledger/b/oard", "led ger/board"])(
    "rejects the malformed column reference %s — the format is two slash-separated segments",
    (column) => {
      const request = { type: "view", title: "T", column };
      expect(CreateDocRequestSchema.safeParse(request).success).toBe(false);
    },
  );
});

describe("MoveDocRequest", () => {
  it("carries the destination folder and the job it serves — the id never changes", () => {
    expect(MoveDocRequestSchema.parse({ folder: "finance" })).toEqual({ folder: "finance" });
    // `job` joined it with CONTRACT-050 (SPEC.md §9.2: any write may name the
    // work it serves). The pin is kept exact rather than loosened to a
    // `toContain`, because what it is guarding is that **no id ever appears
    // here** — a move that could name a document id would be a move that could
    // change identity, which is the one thing this route promises it never does.
    expect(Object.keys(MoveDocRequestSchema.shape)).toEqual(["job", "folder"]);
  });

  it("requires a destination", () => {
    expect(MoveDocRequestSchema.safeParse({}).success).toBe(false);
  });

  /**
   * A move takes no type, so `resolveFolder` is called without one and the
   * §7 roots are out of reach here (CONTRACT-062). The two `folder` fields
   * therefore say different things, and the schemas must not share a constant.
   */
  it("describes a plainer folder grammar than create's", () => {
    const move = MoveDocRequestSchema.shape.folder.meta()?.description ?? "";
    const create = CreateDocRequestSchema.shape.folder.meta()?.description ?? "";
    expect(move).not.toBe(create);
    expect(move).not.toContain("`type: agent-def`");
    expect(move).toContain("data/docs/finance");
  });

  /**
   * CONTRACT-063. The field is required, so the description must not describe a
   * default — and the assertion is written against the *schema* as well as the
   * prose, because the defect was precisely the two disagreeing: a required
   * field whose text explained the default it does not have with a rule
   * (creation is inbox-first) belonging to another route.
   */
  it("claims no default, matching a field that is required", () => {
    const move = MoveDocRequestSchema.shape.folder.meta()?.description ?? "";
    expect(MoveDocRequestSchema.shape.folder.safeParse(undefined).success).toBe(false);
    expect(move).not.toContain("Defaults to");
    expect(move).toContain("it has no default");
  });
});

describe("DeleteDocResult", () => {
  it("round-trips the cascade: the deleted id and the threads it orphaned", () => {
    const result = {
      deletedId: "doc_a1b2c3",
      orphanedThreadIds: ["th_x9y8", "th_q1w2"],
      warnings: [],
    };
    expect(DeleteDocResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips a document that had no threads", () => {
    const result = { deletedId: "doc_a1b2c3", orphanedThreadIds: [], warnings: [] };
    expect(DeleteDocResultSchema.parse(result)).toEqual(result);
  });

  it("carries the §11 warnings of a deletion whose commit was refused", () => {
    const result = {
      deletedId: "doc_a1b2c3",
      orphanedThreadIds: [],
      warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
    };
    expect(DeleteDocResultSchema.parse(result)).toEqual(result);
  });

  it("rejects a document id in the orphaned thread list", () => {
    const result = { deletedId: "doc_a1b2c3", orphanedThreadIds: ["doc_zzz"], warnings: [] };
    expect(DeleteDocResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("UpdateDocRequest and UpdateDocResponse", () => {
  it("accepts a body edit that presents the key it read", () => {
    expect(UpdateDocRequestSchema.parse({ body: "new body", key: DOC_KEY })).toEqual({
      body: "new body",
      key: DOC_KEY,
    });
  });

  /**
   * The whole of SHARED-041, at the boundary: a write that replaces a block
   * without naming the version it replaces is refused before any handler runs.
   * An optional field a server may ignore would be the edit lock again.
   */
  it("refuses a body edit that presents no key", () => {
    const parsed = UpdateDocRequestSchema.safeParse({ body: "new body" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["key"]);
    expect(parsed.error?.issues[0]?.message).toContain("`key` is required");
  });

  /** An emptied body is the most destructive spelling of the write, not an absent one. */
  it("refuses an emptied body that presents no key", () => {
    expect(UpdateDocRequestSchema.safeParse({ body: "" }).success).toBe(false);
    expect(UpdateDocRequestSchema.safeParse({ body: "", key: DOC_KEY }).success).toBe(true);
  });

  it.each([
    ["a tag set", { tags: ["finance"] }],
    ["a status flip", { status: "archived" as const }],
    ['a "still current" mark', { reviewed: "2026-07-26T12:00:00Z" }],
    ["a view key", { pinned: true }],
    ["an extra-frontmatter merge patch", { extra: { "ledger.items": [] } }],
    ["a save that names no change at all", {}],
  ])("takes no key on %s, which names its own delta", (_label, patch) => {
    expect(UpdateDocRequestSchema.safeParse(patch).success).toBe(true);
  });

  /**
   * Presenting a key you hold is never wrong, and it is still checked — so a
   * caller that always sends what it read needs no rule about which fields are
   * which.
   */
  it("accepts a key on a delta write too", () => {
    expect(UpdateDocRequestSchema.parse({ tags: [], key: DOC_KEY }).key).toBe(DOC_KEY);
  });

  it.each([
    ["an empty string", ""],
    ["a document id", "doc_a1b2c3"],
    ["uppercase hex, which would make equality depend on spelling", "A".repeat(64)],
    ["a digest one character short", "a".repeat(63)],
    ["a digest with a non-hex character", `${"a".repeat(63)}z`],
  ])("refuses %s where a key belongs", (_label, key) => {
    expect(UpdateDocRequestSchema.safeParse({ body: "new body", key }).success).toBe(false);
  });

  it('accepts a "still current" review mark', () => {
    expect(UpdateDocRequestSchema.parse({ reviewed: "2026-07-26T12:00:00Z" })).toEqual({
      reviewed: "2026-07-26T12:00:00Z",
    });
  });

  it("accepts a reorder naming only `order` — the drag's minimal write", () => {
    expect(UpdateDocRequestSchema.parse({ order: 15 })).toEqual({ order: 15 });
  });

  it("accepts a query edit, and null to clear the key", () => {
    expect(UpdateDocRequestSchema.parse({ query: { needs: "me" } })).toEqual({
      query: { needs: "me" },
    });
    expect(UpdateDocRequestSchema.parse({ query: null })).toEqual({ query: null });
    expect(UpdateDocRequestSchema.parse({ order: null, column: null })).toEqual({
      order: null,
      column: null,
    });
  });

  it("accepts a per-key extra merge patch, null removing the named key", () => {
    const patch = { extra: { items: [{ text: "x", done: true }], draft: null } };
    expect(UpdateDocRequestSchema.parse(patch)).toEqual(patch);
  });

  it("rejects a core key smuggled through extra on update", () => {
    expect(UpdateDocRequestSchema.safeParse({ extra: { reviewed: "now" } }).success).toBe(false);
  });

  it("round-trips the anchor reconciliation report", () => {
    const response = { doc, anchors: { remapped: ["anc_k4f7"], orphaned: [] }, warnings: [] };
    expect(UpdateDocResponseSchema.parse(response)).toEqual(response);
  });

  it("demands the warnings array rather than treating it as optional", () => {
    const response = { doc, anchors: { remapped: [], orphaned: [] } };
    expect(UpdateDocResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe("DocMutationResponse", () => {
  it("wraps the document so §11 warnings have somewhere to travel", () => {
    const response = {
      doc,
      warnings: [{ code: "commit_skipped" as const, detail: "workspace is not a git repository" }],
    };
    expect(DocMutationResponseSchema.parse(response)).toEqual(response);
  });

  it("round-trips the ordinary case: a document and no warnings", () => {
    const response = { doc, warnings: [] };
    expect(DocMutationResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects a bare document, which is the pre-CONTRACT-005 shape", () => {
    expect(DocMutationResponseSchema.safeParse(doc).success).toBe(false);
  });
});

describe("document type vocabulary", () => {
  it.each(CORE_DOC_TYPES)("recognises the core type %s", (type) => {
    expect(CoreDocTypeSchema.parse(type)).toBe(type);
  });

  it("does not treat an unrecognised type as a core type", () => {
    expect(CoreDocTypeSchema.safeParse("ledger").success).toBe(false);
  });

  it.each(["open", "resolved", "archived"])("recognises the status %s", (status) => {
    expect(DocStatusSchema.parse(status)).toBe(status);
  });
});
