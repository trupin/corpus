import { describe, expect, it } from "vitest";
import { CONTEXT_MAX_SECTION_CHARS } from "./context.js";
import {
  CommitShaSchema,
  DOC_DIFF_MAX_CHARS,
  DOC_EDITED_EVENT_TYPE,
  DocChangeStatsSchema,
  DocDiffQuerySchema,
  DocDiffSchema,
  DocEditedPayloadSchema,
  EDIT_SESSION_END_REASONS,
  EMPTY_TREE_OBJECT_ID,
  parseDocEditedPayload,
} from "./edit.js";
import { EXTRA_MAX_BYTES } from "./extra.js";
import { CORE_QUEUE_EVENT_TYPES, QueueEventSchema } from "./queue.js";

/**
 * SPEC.md §4's edit-acknowledgment rider (signed 2026-08-02): the `doc.edited`
 * payload and the bounded diff read behind `corpus doc diff <id>`. The rider's
 * three load-bearing clauses — never the diff body, actor-scoped, one event per
 * session — are each asserted here rather than left to the server to remember.
 */

const SESSION_HEAD = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";
const SESSION_BASE = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";

const payload = {
  docId: "doc_a1b2c3",
  sessionId: "sess_7c1d",
  actor: "user" as const,
  endedBy: "close" as const,
  from: SESSION_BASE,
  to: SESSION_HEAD,
  stats: { commits: 1, insertions: 12, deletions: 3 },
};

const editedEvent = {
  id: "evt_7c1d",
  type: DOC_EDITED_EVENT_TYPE,
  created: "2026-08-02T10:05:01.000Z",
  source: "server",
  payload,
};

describe("the commit sha shape", () => {
  it.each(["abc1234", "a".repeat(64), SESSION_HEAD])("accepts the sha %s", (sha) => {
    expect(CommitShaSchema.parse(sha)).toBe(sha);
  });

  /**
   * The security half of the shape, not a style preference: every one of these
   * would otherwise be composed into a `git` argv by the server. A rejection
   * here is a `400` naming the parameter, before any handler runs.
   */
  it.each(["HEAD~1", "HEAD", "main", "v1.0.0", "--output=/tmp/x", "-C/etc", "", "..", "abc123"])(
    "refuses the non-sha revision %s",
    (revision) => {
      expect(CommitShaSchema.safeParse(revision).success).toBe(false);
    },
  );

  it("refuses an uppercase sha and one past 64 characters", () => {
    expect(CommitShaSchema.safeParse(SESSION_HEAD.toUpperCase()).success).toBe(false);
    expect(CommitShaSchema.safeParse("a".repeat(65)).success).toBe(false);
  });

  /**
   * The empty-tree constant exists so a range whose head is a document's first
   * commit is still a *range* — passable straight back to the diff route — rather
   * than a null a consumer has to special-case. That only works if it is itself a
   * legal sha.
   */
  it("keeps the empty-tree object id a legal sha", () => {
    expect(CommitShaSchema.parse(EMPTY_TREE_OBJECT_ID)).toBe(EMPTY_TREE_OBJECT_ID);
    expect(EMPTY_TREE_OBJECT_ID).toHaveLength(40);
  });
});

describe("the change stats", () => {
  it("carries the three counts git furnishes without reading the diff", () => {
    expect(Object.keys(DocChangeStatsSchema.parse(payload.stats))).toEqual([
      "commits",
      "insertions",
      "deletions",
    ]);
  });

  /** A file count would always be 1 on both surfaces, so it is deliberately absent. */
  it("declares no file count", () => {
    const parsed: Record<string, unknown> = DocChangeStatsSchema.parse({
      ...payload.stats,
      files: 1,
    });
    expect(parsed).not.toHaveProperty("files");
  });

  it.each(["commits", "insertions", "deletions"])("refuses a negative %s", (field) => {
    expect(DocChangeStatsSchema.safeParse({ ...payload.stats, [field]: -1 }).success).toBe(false);
  });

  it.each(["commits", "insertions", "deletions"])("refuses a fractional %s", (field) => {
    expect(DocChangeStatsSchema.safeParse({ ...payload.stats, [field]: 1.5 }).success).toBe(false);
  });

  /**
   * Zero commits is the diff route's no-history answer. It is representable
   * rather than refined away because refining a *registered* component through
   * `.extend()` would propagate its name onto the derived schema — the hazard
   * `./id.ts` documents — so the "a `doc.edited` never carries 0" half is a
   * documented emitter rule, asserted from the payload side below.
   */
  it("admits a zero-commit range, which only the diff route can produce", () => {
    expect(DocChangeStatsSchema.parse({ commits: 0, insertions: 0, deletions: 0 })).toEqual({
      commits: 0,
      insertions: 0,
      deletions: 0,
    });
  });
});

describe("the doc.edited payload", () => {
  it("is a member of the core event vocabulary", () => {
    expect(CORE_QUEUE_EVENT_TYPES).toContain(DOC_EDITED_EVENT_TYPE);
  });

  it("carries the document, the session, the range and the stats — and nothing else", () => {
    expect(Object.keys(DocEditedPayloadSchema.parse(payload))).toEqual([
      "docId",
      "sessionId",
      "actor",
      "endedBy",
      "from",
      "to",
      "stats",
    ]);
  });

  /**
   * The rider's "never the diff body", asserted as an absence: no field of this
   * payload can carry document content, so an event's size cannot scale with
   * the size of the change it announces (SPEC.md §2.2).
   */
  it("has nowhere to put a diff body", () => {
    const smuggled: Record<string, unknown> = DocEditedPayloadSchema.parse({
      ...payload,
      diff: "@@ -1 +1 @@\n-old\n+new\n",
      body: "the whole document",
    });
    expect(smuggled).not.toHaveProperty("diff");
    expect(smuggled).not.toHaveProperty("body");
  });

  it.each(EDIT_SESSION_END_REASONS)("accepts the end reason %s", (endedBy) => {
    expect(DocEditedPayloadSchema.parse({ ...payload, endedBy }).endedBy).toBe(endedBy);
  });

  it("refuses an end reason outside the two SPEC.md §4 names", () => {
    expect(DocEditedPayloadSchema.safeParse({ ...payload, endedBy: "blur" }).success).toBe(false);
  });

  /** The dedupe key is required, because idempotence has to be expressible. */
  it("demands a non-empty session id", () => {
    expect(DocEditedPayloadSchema.safeParse({ ...payload, sessionId: "" }).success).toBe(false);
    const { sessionId: _omitted, ...withoutSession } = payload;
    expect(DocEditedPayloadSchema.safeParse(withoutSession).success).toBe(false);
  });

  it("demands a sha at both ends of the range, so it can be replayed verbatim", () => {
    expect(DocEditedPayloadSchema.safeParse({ ...payload, from: "HEAD~1" }).success).toBe(false);
    expect(DocEditedPayloadSchema.safeParse({ ...payload, to: "" }).success).toBe(false);
  });

  it("accepts the empty tree as a base, for a session that is a document's first", () => {
    expect(DocEditedPayloadSchema.parse({ ...payload, from: EMPTY_TREE_OBJECT_ID }).from).toBe(
      EMPTY_TREE_OBJECT_ID,
    );
  });

  it("rides inside the open queue-event envelope unchanged", () => {
    expect(QueueEventSchema.parse(editedEvent).payload).toEqual(payload);
  });

  /**
   * The range the event hands over is exactly what the diff route accepts —
   * "pass back what I was handed", with no parsing, resolving or reconstruction
   * anywhere in the agent's loop.
   */
  it("hands over a range the diff route takes verbatim", () => {
    const parsed = DocEditedPayloadSchema.parse(payload);
    expect(DocDiffQuerySchema.parse({ from: parsed.from, to: parsed.to })).toEqual({
      from: SESSION_BASE,
      to: SESSION_HEAD,
    });
  });
});

/**
 * The rider's hard requirement: "Agent-authored edits never emit the event
 * (actor-scoped), so the loop cannot feed itself." Expressed as a literal, so
 * the guarantee holds at the consumer as well as at the emitter.
 */
describe("actor scoping", () => {
  it("accepts the user actor", () => {
    expect(DocEditedPayloadSchema.parse(payload).actor).toBe("user");
  });

  it.each(["agent", "system", ""])("refuses a payload claiming actor %s", (actor) => {
    expect(DocEditedPayloadSchema.safeParse({ ...payload, actor }).success).toBe(false);
  });

  it("demands the actor rather than defaulting it", () => {
    const { actor: _omitted, ...withoutActor } = payload;
    expect(DocEditedPayloadSchema.safeParse(withoutActor).success).toBe(false);
  });

  it("drops an agent-authored event at the narrowing boundary", () => {
    expect(parseDocEditedPayload({ ...editedEvent, payload: { ...payload, actor: "agent" } })).toBe(
      undefined,
    );
  });
});

describe("parseDocEditedPayload", () => {
  it("narrows a well-formed event", () => {
    expect(parseDocEditedPayload(editedEvent)).toEqual(payload);
  });

  it.each(["comment.created", "form.respond", "todo.due"])("ignores a %s event", (type) => {
    expect(parseDocEditedPayload({ ...editedEvent, type })).toBe(undefined);
  });

  /** Events come off disk: an older server's payload is skipped, never thrown on. */
  it.each([{}, null, "not an object", { docId: "doc_a1b2c3" }])(
    "skips the malformed payload %j rather than throwing",
    (malformed) => {
      expect(parseDocEditedPayload({ ...editedEvent, payload: malformed })).toBe(undefined);
    },
  );
});

describe("the diff query", () => {
  it("takes no range at all, which is the bare `corpus doc diff <id>`", () => {
    expect(DocDiffQuerySchema.parse({})).toEqual({});
  });

  it("takes either half alone", () => {
    expect(DocDiffQuerySchema.parse({ to: SESSION_HEAD })).toEqual({ to: SESSION_HEAD });
    expect(DocDiffQuerySchema.parse({ from: SESSION_BASE })).toEqual({ from: SESSION_BASE });
  });

  it("declares no Zod default, since both defaults are computed from history", () => {
    expect(DocDiffQuerySchema.parse({})).not.toHaveProperty("from");
    expect(DocDiffQuerySchema.parse({})).not.toHaveProperty("to");
  });

  it.each(["from", "to"])("refuses a named revision in %s", (field) => {
    expect(DocDiffQuerySchema.safeParse({ [field]: "HEAD~1" }).success).toBe(false);
  });
});

describe("the diff response", () => {
  const diff = {
    id: "doc_a1b2c3",
    path: "data/docs/finance/mortgage.md",
    from: SESSION_BASE,
    to: SESSION_HEAD,
    stats: { commits: 1, insertions: 12, deletions: 3 },
    diff: "@@ -1,2 +1,2 @@\n-old\n+new\n",
    truncated: false,
    totalChars: 26,
  };

  it("reports the resolved range back, so a defaulted call knows what it read", () => {
    expect(DocDiffSchema.parse(diff)).toMatchObject({ from: SESSION_BASE, to: SESSION_HEAD });
  });

  it("accepts a body exactly at the published bound", () => {
    const body = "x".repeat(DOC_DIFF_MAX_CHARS);
    expect(
      DocDiffSchema.parse({ ...diff, diff: body, truncated: true, totalChars: 99999 }).diff,
    ).toHaveLength(DOC_DIFF_MAX_CHARS);
  });

  it("refuses a body one character past it, which is what makes the cap an oracle", () => {
    const body = "x".repeat(DOC_DIFF_MAX_CHARS + 1);
    expect(DocDiffSchema.safeParse({ ...diff, diff: body }).success).toBe(false);
  });

  /**
   * The no-history answer: a document never committed, or a workspace with no
   * git (SPEC.md §14). A `200` with a null range rather than an error, because
   * the document plainly exists and genuinely has no change to show.
   */
  it("represents a document with no committed history as a null range", () => {
    const empty = {
      ...diff,
      from: null,
      to: null,
      stats: { commits: 0, insertions: 0, deletions: 0 },
      diff: "",
      totalChars: 0,
    };
    expect(DocDiffSchema.parse(empty)).toMatchObject({ from: null, to: null, diff: "" });
  });

  it("refuses a negative total, since it measures a length", () => {
    expect(DocDiffSchema.safeParse({ ...diff, totalChars: -1 }).success).toBe(false);
  });
});

/**
 * The bound is a chosen number with a written rationale, so the relationships
 * it was chosen against are pinned: moving it without revisiting them fails
 * here rather than silently making a "bounded" read unbounded in practice.
 */
describe("the diff bound sits where the rationale puts it", () => {
  it("is four times the context pack's section cap", () => {
    expect(DOC_DIFF_MAX_CHARS).toBe(CONTEXT_MAX_SECTION_CHARS * 4);
  });

  it("stays under a quarter of the extra-frontmatter byte cap", () => {
    expect(DOC_DIFF_MAX_CHARS).toBeLessThan(EXTRA_MAX_BYTES / 4);
  });
});
