import { describe, expect, it } from "vitest";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  DeleteTurnResultSchema,
  MarkSeenRequestSchema,
  MarkSeenResultSchema,
  type MarkSeenResult,
  MultipartAppendTurnRequestSchema,
  THREAD_AGENT_STATES,
  ThreadAgentSchema,
  ThreadMutationResponseSchema,
  ThreadSchema,
  ThreadSummarySchema,
  TurnSchema,
} from "./thread.js";

const turns = [
  {
    author: "user",
    ts: "2026-07-19T10:05:00Z",
    body: "@agent is 6.1% still the right assumption?",
  },
  { author: "agent", ts: "2026-07-19T10:07:12Z", body: "Checked current averages; 6.4%." },
];

const thread = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  status: "open",
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged",
  turns,
};

describe("Turn", () => {
  it.each(turns)("round-trips the $author turn", (turn) => {
    expect(TurnSchema.parse(turn)).toEqual(turn);
  });

  it("rejects an author that is neither user nor agent", () => {
    expect(TurnSchema.safeParse({ ...turns[0], author: "system" }).success).toBe(false);
  });
});

describe("Thread", () => {
  it("round-trips an anchored thread", () => {
    expect(ThreadSchema.parse(thread)).toEqual(thread);
  });

  it("round-trips a standalone thread, which has neither parent nor anchor", () => {
    const standalone = { ...thread, parent: null, anchor: null, agent: "requested" };
    expect(ThreadSchema.parse(standalone)).toEqual(standalone);
  });

  it("round-trips a thread whose parent is itself a thread", () => {
    const nested = { ...thread, parent: "th_other1" };
    expect(ThreadSchema.parse(nested).parent).toBe("th_other1");
  });

  it("rejects `archived`, which is a document status but not a thread status", () => {
    expect(ThreadSchema.safeParse({ ...thread, status: "archived" }).success).toBe(false);
  });
});

describe("ThreadSummary", () => {
  it("round-trips the projection row", () => {
    const summary = {
      id: "th_x9y8",
      title: "Re: 30-year fixed assumption",
      status: "resolved",
      parent: "doc_a1b2c3",
      anchor: "anc_k4f7",
      agent: "engaged",
      created: "2026-07-19T10:05:00Z",
      updated: "2026-07-19T10:07:12Z",
      turnCount: 2,
      lastAuthor: "agent",
      lastTs: "2026-07-19T10:07:12Z",
    };
    expect(ThreadSummarySchema.parse(summary)).toEqual(summary);
  });

  /**
   * The summary is a resource — every thread list row is one — so §14's warnings
   * ride the mutation's own envelope instead. A warnings array on the row would
   * be empty on every read and would make "did this mutation warn?" unanswerable.
   */
  it("carries no warnings of its own", () => {
    expect(Object.keys(ThreadSummarySchema.shape)).not.toContain("warnings");
  });
});

describe("ThreadMutationResponse", () => {
  const summary = {
    id: "th_x9y8",
    title: "Re: 30-year fixed assumption",
    status: "resolved" as const,
    parent: "doc_a1b2c3",
    anchor: "anc_k4f7",
    agent: "engaged" as const,
    created: "2026-07-19T10:05:00Z",
    updated: "2026-07-19T10:07:12Z",
    turnCount: 2,
    lastAuthor: "agent" as const,
    lastTs: "2026-07-19T10:07:12Z",
  };

  it("round-trips a resolve that committed cleanly", () => {
    const response = { thread: summary, warnings: [] };
    expect(ThreadMutationResponseSchema.parse(response)).toEqual(response);
  });

  /** Resolving rewrites and auto-commits the thread file: a rejected hook surfaces here. */
  it("round-trips a resolve whose auto-commit was rejected", () => {
    const response = {
      thread: summary,
      warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
    };
    expect(ThreadMutationResponseSchema.parse(response)).toEqual(response);
  });

  it("requires the warnings array rather than letting it be omitted", () => {
    expect(ThreadMutationResponseSchema.safeParse({ thread: summary }).success).toBe(false);
  });
});

describe("CreateThreadRequest", () => {
  /**
   * `parent` and `selector` stay absent rather than defaulting to null, for the
   * same reason as `CreateDocRequest`'s optional fields: a Zod default renders
   * as a required member of the generated client type (CONTRACT-003). Omitted
   * and explicit null mean the same thing here, so nothing is lost.
   */
  it("leaves parent and selector absent, which the server reads as a standalone thread", () => {
    const parsed = CreateThreadRequestSchema.parse({ body: "Ask from nowhere." });
    expect(parsed).toEqual({ body: "Ask from nowhere." });
    expect(parsed.requestsAgent).toBeUndefined();
  });

  it("accepts an explicit null parent and selector as the same instruction", () => {
    const request = { parent: null, selector: null, body: "Ask from nowhere." };
    expect(CreateThreadRequestSchema.parse(request)).toEqual(request);
  });

  it("carries a selection so the server can write the parent's anchor entry", () => {
    const request = {
      parent: "doc_a1b2c3",
      selector: { exact: "6.1%", prefix: "at ", suffix: " which" },
      body: "@agent still right?",
      requestsAgent: true,
    };
    expect(CreateThreadRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts a selector carrying only its quote, leaving the context to the server", () => {
    const parsed = CreateThreadRequestSchema.parse({
      parent: "doc_a1b2c3",
      selector: { exact: "6.1%" },
      body: "@agent still right?",
    });
    expect(parsed.selector).toEqual({ exact: "6.1%" });
  });

  it("rejects an empty first turn", () => {
    expect(CreateThreadRequestSchema.safeParse({ body: "" }).success).toBe(false);
  });
});

describe("CreateThreadResponse", () => {
  it("reports the written anchor and the enqueued event", () => {
    const response = { thread, anchorId: "anc_k4f7", eventId: "evt_7c1d", warnings: [] };
    expect(CreateThreadResponseSchema.parse(response)).toEqual(response);
  });

  it("reports nulls when nothing was anchored and the agent was not requested", () => {
    const response = { thread, anchorId: null, eventId: null, warnings: [] };
    expect(CreateThreadResponseSchema.parse(response)).toEqual(response);
  });

  /**
   * The case the field exists for: anchored creation writes the parent's
   * frontmatter, so a hook that refuses the commit leaves the parent uncommitted
   * and the commenter has to be told (SPEC.md §14).
   */
  it("carries a rejected auto-commit on an anchored creation", () => {
    const response = {
      thread,
      anchorId: "anc_k4f7",
      eventId: null,
      warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
    };
    expect(CreateThreadResponseSchema.parse(response)).toEqual(response);
  });
});

describe("AppendTurnRequest and AppendTurnResponse", () => {
  it("leaves an unset enqueue signal unset, rather than deciding for the server", () => {
    const parsed = AppendTurnRequestSchema.parse({ body: "just a note" });
    expect(parsed).toEqual({ body: "just a note" });
    expect("requestsAgent" in parsed).toBe(false);
  });

  it("round-trips the appended turn with its updated thread summary", () => {
    const response = {
      thread: {
        id: "th_x9y8",
        title: "Re: 30-year fixed assumption",
        status: "open",
        parent: "doc_a1b2c3",
        anchor: "anc_k4f7",
        agent: "engaged",
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user",
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user", ts: "2026-07-19T10:09:00Z", body: "thanks" },
      eventId: null,
      warnings: [],
    };
    expect(AppendTurnResponseSchema.parse(response)).toEqual(response);
  });
});

describe("MultipartAppendTurnRequest", () => {
  const png = () => new File(["bytes"], "screenshot.png", { type: "image/png" });

  it("accepts text with no files", () => {
    expect(MultipartAppendTurnRequestSchema.parse({ text: "just a note" })).toEqual({
      text: "just a note",
      files: [],
    });
  });

  /** SPEC.md §6: "a turn may be attachment-only (no text)". */
  it("accepts a file with no text", () => {
    const file = png();
    const parsed = MultipartAppendTurnRequestSchema.parse({ files: file });
    expect(parsed.files).toEqual([file]);
    expect(parsed.text).toBeUndefined();
  });

  it("accepts text and several files together", () => {
    const files = [png(), png()];
    const parsed = MultipartAppendTurnRequestSchema.parse({ text: "look", files });
    expect(parsed.files).toEqual(files);
  });

  it("rejects a turn with neither text nor files, naming the constraint", () => {
    const result = MultipartAppendTurnRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("text");
  });

  it("rejects an empty text with no files, which is the same nothing", () => {
    expect(MultipartAppendTurnRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });
});

describe("MarkSeenRequest and MarkSeenResult", () => {
  it("accepts a bodiless mark, defaulting to the thread's last turn server-side", () => {
    const parsed = MarkSeenRequestSchema.parse({});
    expect(parsed).toEqual({});
    expect(parsed.lastSeenTs).toBeUndefined();
  });

  it("carries an explicit partial-read mark through", () => {
    expect(MarkSeenRequestSchema.parse({ lastSeenTs: "2026-07-19T10:05:00Z" })).toEqual({
      lastSeenTs: "2026-07-19T10:05:00Z",
    });
  });

  it("rejects a mark that is not an instant", () => {
    expect(MarkSeenRequestSchema.safeParse({ lastSeenTs: "2026-07-19" }).success).toBe(false);
  });

  it("round-trips the recorded mark", () => {
    const result = {
      threadId: "th_x9y8",
      lastSeenTs: "2026-07-19T10:07:12Z",
      unread: false,
    };
    expect(MarkSeenResultSchema.parse(result)).toEqual(result);
  });

  /**
   * The request schema accepts a `lastSeenTs` before the last turn to record a
   * partial read, after which turns remain unseen and the badge stays lit
   * (SPEC.md §7). `unread` is the only field that can say so, which is why it is
   * a boolean rather than `literal(false)`.
   */
  it("round-trips a partial mark that leaves the thread unread", () => {
    const result = {
      threadId: "th_x9y8",
      // The first of the two turns: the later one is still unread.
      lastSeenTs: "2026-07-19T10:05:00Z",
      unread: true,
    };
    expect(MarkSeenResultSchema.parse(result)).toEqual(result);
  });

  /**
   * A type-level probe, checked by `tsc --noEmit` rather than at runtime: the
   * annotation is what fails to compile if `unread` narrows back to `false`.
   */
  it("makes the partial mark representable in the inferred type, not just at parse time", () => {
    const partial: MarkSeenResult = {
      threadId: "th_x9y8",
      lastSeenTs: "2026-07-19T10:05:00Z",
      unread: true,
    };
    expect(partial.unread).toBe(true);
  });

  it("still rejects a non-boolean unread flag rather than coercing it", () => {
    const result = { threadId: "th_x9y8", lastSeenTs: "2026-07-19T10:07:12Z", unread: "yes" };
    expect(MarkSeenResultSchema.safeParse(result).success).toBe(false);
  });
});

/** SPEC.md §6's cascade, reported so the client knows which caches to drop. */
describe("DeleteTurnResult", () => {
  it("round-trips a turn deleted from the middle of a thread", () => {
    const result = {
      deletedTurn: true,
      deletedThread: false,
      removedAnchor: null,
      parentId: "doc_a1b2c3",
      warnings: [],
    };
    expect(DeleteTurnResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips the full cascade: last turn, thread and anchor all gone", () => {
    const result = {
      deletedTurn: true,
      deletedThread: true,
      removedAnchor: "anc_k4f7",
      parentId: "doc_a1b2c3",
      warnings: [],
    };
    expect(DeleteTurnResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips a standalone thread, which has no parent to update", () => {
    const result = {
      deletedTurn: true,
      deletedThread: true,
      removedAnchor: null,
      parentId: null,
      warnings: [],
    };
    expect(DeleteTurnResultSchema.parse(result)).toEqual(result);
  });

  /** The cascade rewrites the parent's frontmatter, so it can warn like any write. */
  it("carries a commit warning raised while removing the parent's anchor entry", () => {
    const result = {
      deletedTurn: true,
      deletedThread: true,
      removedAnchor: "anc_k4f7",
      parentId: "doc_a1b2c3",
      warnings: [{ code: "commit_skipped" as const, detail: "workspace is not a git repository" }],
    };
    expect(DeleteTurnResultSchema.parse(result)).toEqual(result);
  });

  it("cannot report a deletion that did not happen", () => {
    const result = {
      deletedTurn: false,
      deletedThread: false,
      removedAnchor: null,
      parentId: null,
      warnings: [],
    };
    expect(DeleteTurnResultSchema.safeParse(result).success).toBe(false);
  });
});

/**
 * One definition, spread — not four look-alike arrays. The rule that matters to
 * a consumer is that the key is always there, so "no warnings" is an empty array
 * and never an absent field.
 */
describe("§14 warnings travel on every thread mutation", () => {
  const shapes = [
    {
      name: "CreateThreadResponse",
      schema: CreateThreadResponseSchema,
      base: { thread, anchorId: null, eventId: null },
    },
    {
      name: "AppendTurnResponse",
      schema: AppendTurnResponseSchema,
      base: {
        thread: {
          id: "th_x9y8",
          title: "Re: 30-year fixed assumption",
          status: "open",
          parent: "doc_a1b2c3",
          anchor: "anc_k4f7",
          agent: "engaged",
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:09:00Z",
          turnCount: 3,
          lastAuthor: "user",
          lastTs: "2026-07-19T10:09:00Z",
        },
        turn: { author: "user", ts: "2026-07-19T10:09:00Z", body: "thanks" },
        eventId: null,
      },
    },
    {
      name: "DeleteTurnResult",
      schema: DeleteTurnResultSchema,
      base: {
        deletedTurn: true,
        deletedThread: false,
        removedAnchor: null,
        parentId: "doc_a1b2c3",
      },
    },
  ] as const;

  describe.each(shapes)("$name", ({ schema, base }) => {
    it("demands the warnings array rather than treating it as optional", () => {
      expect(schema.safeParse(base).success).toBe(false);
    });

    it("accepts several warnings from the one mutation", () => {
      const warnings = [
        { code: "commit_failed" as const, detail: "pre-commit hook exited 1" },
        { code: "orphaned_anchor" as const, detail: "anc_k4f7 no longer resolves" },
      ];
      expect(schema.parse({ ...base, warnings }).warnings).toEqual(warnings);
    });

    it("rejects a warning code outside the closed set", () => {
      const warnings = [{ code: "disk_full", detail: "…" }];
      expect(schema.safeParse({ ...base, warnings }).success).toBe(false);
    });
  });
});

describe("agent participation", () => {
  it.each(THREAD_AGENT_STATES)("recognises the %s state", (state) => {
    expect(ThreadAgentSchema.parse(state)).toBe(state);
  });
});

/**
 * SPEC.md §8: a reply in an engaged thread re-triggers the agent unless the user
 * posts with the "note only" toggle. That toggle only exists if an explicit
 * `false` stays distinguishable from an omitted field after validation.
 */
describe("requestsAgent is a tri-state enqueue signal", () => {
  const schemas = [
    { name: "AppendTurnRequest", schema: AppendTurnRequestSchema, base: { body: "reply" } },
    { name: "CreateThreadRequest", schema: CreateThreadRequestSchema, base: { body: "first" } },
  ] as const;

  describe.each(schemas)("$name", ({ schema, base }) => {
    it('preserves an explicit false, which is the "note only" instruction', () => {
      const parsed = schema.parse({ ...base, requestsAgent: false });
      expect(parsed.requestsAgent).toBe(false);
    });

    it("preserves an explicit true", () => {
      expect(schema.parse({ ...base, requestsAgent: true }).requestsAgent).toBe(true);
    });

    it("leaves an omitted signal undefined, so the server applies its own rule", () => {
      expect(schema.parse(base).requestsAgent).toBeUndefined();
    });

    it("keeps explicit false distinguishable from omission", () => {
      const explicit = schema.parse({ ...base, requestsAgent: false });
      const omitted = schema.parse(base);
      expect(explicit.requestsAgent).not.toBe(omitted.requestsAgent);
    });

    it("rejects a non-boolean signal rather than coercing it", () => {
      expect(schema.safeParse({ ...base, requestsAgent: "false" }).success).toBe(false);
    });
  });

  /**
   * The multipart body carries the same tri-state over text parts. `z.coerce
   * .boolean()` would read `"false"` as true and silently destroy the toggle,
   * which is why the field is a string-boolean rather than a coerced one.
   */
  describe("MultipartAppendTurnRequest", () => {
    const base = { text: "reply" };

    it('preserves an explicit "false", which is the "note only" instruction', () => {
      expect(
        MultipartAppendTurnRequestSchema.parse({ ...base, requestsAgent: "false" }).requestsAgent,
      ).toBe(false);
    });

    it('preserves an explicit "true"', () => {
      expect(
        MultipartAppendTurnRequestSchema.parse({ ...base, requestsAgent: "true" }).requestsAgent,
      ).toBe(true);
    });

    it("leaves an omitted signal undefined, so the server applies its own rule", () => {
      const parsed = MultipartAppendTurnRequestSchema.parse(base);
      expect(parsed.requestsAgent).toBeUndefined();
      expect("requestsAgent" in parsed).toBe(false);
    });

    it("rejects a value that is neither true nor false", () => {
      expect(
        MultipartAppendTurnRequestSchema.safeParse({ ...base, requestsAgent: "maybe" }).success,
      ).toBe(false);
    });
  });
});
