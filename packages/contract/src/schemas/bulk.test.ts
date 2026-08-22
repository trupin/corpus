import { describe, expect, it } from "vitest";
import {
  BULK_ACTION_NAMES,
  BULK_REFUSAL_REASONS,
  BULK_WHOLE_RESULT_SET_ACTION_NAMES,
  BulkActionOutcomeSchema,
  BulkActionRefusalSchema,
  BulkActionRequestSchema,
  BulkActionResultSchema,
  BulkWholeResultSetEntrySchema,
} from "./bulk.js";

const entry = (id: string, action: unknown): unknown => ({ id, action });

const request = (entries: unknown, wholeResultSet?: unknown): unknown =>
  wholeResultSet === undefined ? { entries } : { entries, wholeResultSet };

const one = (action: unknown, id = "doc_a1b2c3"): unknown => request([entry(id, action)]);

describe("the staged set the Save sends (CONTRACT-048)", () => {
  /**
   * SHARED-032's whole point, and the reason `{ids, action}` had to go: §4 —
   * "a Save carrying a mix of verbs is still one act and still one commit".
   */
  it("carries a different act per row, in one request", () => {
    const parsed = BulkActionRequestSchema.parse(
      request([
        entry("doc_a1b2c3", { action: "archive" }),
        entry("doc_b2c3d4", { action: "archive" }),
        entry("doc_c3d4e5", { action: "archive" }),
        entry("th_x9y8", { action: "resolve" }),
        entry("th_a1b2", { action: "resolve" }),
      ]),
    );
    expect(parsed.entries.map((row) => row.action.action)).toEqual([
      "archive",
      "archive",
      "archive",
      "resolve",
      "resolve",
    ]);
    expect(parsed.wholeResultSet).toBeUndefined();
  });

  /** The old shape's case — one verb over many ids — is still one request. */
  it("still expresses a uniform set, which is what the old shape could say", () => {
    const parsed = BulkActionRequestSchema.parse(
      request(
        ["doc_a1b2c3", "doc_b2c3d4", "th_x9y8"].map((id) => entry(id, { action: "archive" })),
      ),
    );
    expect(parsed.entries.map((row) => row.id)).toEqual(["doc_a1b2c3", "doc_b2c3d4", "th_x9y8"]);
    expect(new Set(parsed.entries.map((row) => row.action.action))).toEqual(new Set(["archive"]));
  });

  /** An act on nothing is a caller bug; a `200` with three empty lists hides it. */
  it("rejects a staged set with nothing in it", () => {
    const result = BulkActionRequestSchema.safeParse(request([]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("nothing staged");
  });

  it("accepts an empty `entries` when a whole-result-set entry carries the act", () => {
    const parsed = BulkActionRequestSchema.parse(
      request([], { query: { type: "note" }, action: { action: "archive" } }),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.wholeResultSet?.action.action).toBe("archive");
  });

  it("validates every id against the document id grammar", () => {
    expect(BulkActionRequestSchema.safeParse(one({ action: "archive" }, "nope")).success).toBe(
      false,
    );
    expect(BulkActionRequestSchema.safeParse(one({ action: "archive" }, "evt_7c1d")).success).toBe(
      false,
    );
  });

  it("threads are documents, so thread ids need no separate route", () => {
    expect(
      BulkActionRequestSchema.safeParse(
        request([entry("th_x9y8", { action: "resolve" }), entry("th_a1", { action: "reopen" })]),
      ).success,
    ).toBe(true);
  });

  it("rejects an act it does not declare", () => {
    expect(BulkActionRequestSchema.safeParse(one({ action: "publish" })).success).toBe(false);
    expect(BulkActionRequestSchema.safeParse(one({})).success).toBe(false);
  });

  it("offers exactly SPEC.md §10's selection actions, minus the one that changes nothing", () => {
    expect([...BULK_ACTION_NAMES]).toEqual([
      "archive",
      "unarchive",
      "resolve",
      "reopen",
      "move",
      "tag",
      "review",
      "delete",
    ]);
    // "Ask the agent about these" creates a thread through `POST /api/threads`
    // and changes none of the selected documents, so it is not an act here.
    expect(BULK_ACTION_NAMES).not.toContain("ask");
  });

  /** Strict, like every request body (CONTRACT-017) — the entry and the act both. */
  it.each([
    { entries: [{ id: "doc_a1b2c3", action: { action: "archive" }, actor: "user" }] },
    { entries: [{ id: "doc_a1b2c3", action: { action: "archive", folder: "finance" } }] },
    { entries: [{ id: "doc_a1b2c3", action: { action: "move" } }] },
    { entries: [{ id: "doc_a1b2c3", action: { action: "move", folder: "f", tags: ["q3"] } }] },
    { entries: [{ id: "doc_a1b2c3" }] },
    { entries: [{ action: { action: "archive" } }] },
    { ids: ["doc_a1b2c3"], action: { action: "archive" } },
  ])("rejects the malformed body %j before any handler runs", (body) => {
    expect(BulkActionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("takes a destination folder on a move", () => {
    const parsed = BulkActionRequestSchema.parse(one({ action: "move", folder: "finance" }));
    expect(parsed.entries[0]?.action).toEqual({ action: "move", folder: "finance" });
  });
});

/**
 * §10 makes a row carry exactly one staged action — "re-choosing *replaces* a
 * row's staged action" — so the same id twice is a staged set that was keyed
 * wrong. Refusing is the point: last-write-wins would be a silent choice about
 * someone's documents, and applying both would write one document twice inside
 * an act that promises to be one commit of exactly what changed (§4).
 */
describe("an id staged twice is refused, and the refusal says why", () => {
  it("refuses conflicting acts on one id, naming the id and both acts", () => {
    const result = BulkActionRequestSchema.safeParse(
      request([
        entry("doc_a1b2c3", { action: "archive" }),
        entry("doc_b2c3d4", { action: "resolve" }),
        entry("doc_a1b2c3", { action: "delete" }),
      ]),
    );
    expect(result.success).toBe(false);
    const message = result.error?.issues.map((issue) => issue.message).join("\n") ?? "";
    expect(message).toContain("doc_a1b2c3");
    expect(message).toContain("staged twice with different actions");
    expect(message).toContain("archive");
    expect(message).toContain("delete");
    // Never silently resolved.
    expect(message).not.toContain("ignored");
  });

  it("points the issue at the offending entry rather than at the body", () => {
    const result = BulkActionRequestSchema.safeParse(
      request([
        entry("doc_a1b2c3", { action: "archive" }),
        entry("doc_a1b2c3", { action: "review" }),
      ]),
    );
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("entries.1.id");
  });

  /**
   * CONTRACT-037 collapsed a repeated id, because a repeated member of an `ids`
   * **set** carried no information. A repeated staged **row** carries a verb, so
   * the tolerance is deliberately gone; the message still distinguishes the two
   * cases so a caller can tell a keying bug from a genuine contradiction.
   */
  it("refuses a repeat even when both entries name the same act", () => {
    const result = BulkActionRequestSchema.safeParse(
      request([
        entry("doc_a1b2c3", { action: "archive" }),
        entry("doc_a1b2c3", { action: "archive" }),
      ]),
    );
    expect(result.success).toBe(false);
    const message = result.error?.issues.map((issue) => issue.message).join("\n") ?? "";
    expect(message).toContain("staged twice");
    expect(message).not.toContain("different actions");
  });

  it("refuses two `tag` entries on one id, whose deltas could differ", () => {
    expect(
      BulkActionRequestSchema.safeParse(
        request([
          entry("doc_a1b2c3", { action: "tag", add: ["q3"] }),
          entry("doc_a1b2c3", { action: "tag", remove: ["inbox"] }),
        ]),
      ).success,
    ).toBe(false);
  });

  it("leaves distinct ids alone, however many verbs they carry between them", () => {
    expect(
      BulkActionRequestSchema.safeParse(
        request([
          entry("doc_a1b2c3", { action: "archive" }),
          entry("doc_b2c3d4", { action: "review" }),
          entry("th_x9y8", { action: "resolve" }),
          entry("th_a1b2", { action: "reopen" }),
        ]),
      ).success,
    ).toBe(true);
  });
});

/**
 * §10: "Because there is no per-row gesture for rows nobody enumerated, a
 * whole-result-set selection stages as a **single entry** — one line reading
 * what it covers and how many, carrying one action for all of them."
 */
describe("the whole-result-set entry (SPEC.md §10)", () => {
  const query = { type: ["note", "view"], tag: "finance" };

  it("carries one action for a query rather than for enumerated ids", () => {
    const parsed = BulkActionRequestSchema.parse(
      request([], { query, action: { action: "tag", add: ["q3"] } }),
    );
    expect(parsed.wholeResultSet?.query).toEqual(query);
    expect(parsed.wholeResultSet?.action).toEqual({ action: "tag", add: ["q3"] });
  });

  it("sits beside individually staged rows in the same request", () => {
    const parsed = BulkActionRequestSchema.parse(
      request([entry("doc_a1b2c3", { action: "review" })], {
        query,
        action: { action: "archive" },
      }),
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.wholeResultSet?.action.action).toBe("archive");
  });

  /**
   * §10: "Bulk delete is offered **only** on a selection whose documents are
   * enumerated — a whole-result-set selection cannot be deleted." Structural, so
   * it is a type error rather than a refusal discovered on 412 documents.
   */
  it("cannot spell `delete`", () => {
    expect(
      BulkWholeResultSetEntrySchema.safeParse({ query, action: { action: "delete" } }).success,
    ).toBe(false);
    expect(
      BulkActionRequestSchema.safeParse(request([], { query, action: { action: "delete" } }))
        .success,
    ).toBe(false);
    expect([...BULK_WHOLE_RESULT_SET_ACTION_NAMES]).toEqual([
      "archive",
      "unarchive",
      "resolve",
      "reopen",
      "move",
      "tag",
      "review",
    ]);
  });

  /** An enumerated `delete` is untouched by that restriction. */
  it("leaves an enumerated delete expressible", () => {
    expect(BulkActionRequestSchema.safeParse(one({ action: "delete" })).success).toBe(true);
  });

  /**
   * The query is a `type: view` document's own stored query — the same flat
   * parameter map `ViewQuery` publishes — so a column can send what it holds
   * without a second grammar in between.
   */
  it.each([{}, { needs: "me" }, { pinned: true }, { limit: 50 }, { type: ["note", "view"] }])(
    "accepts the view-query shape %j a column actually stores",
    (shape) => {
      expect(
        BulkWholeResultSetEntrySchema.safeParse({ query: shape, action: { action: "archive" } })
          .success,
      ).toBe(true);
    },
  );

  it("is strict, and takes no ids of its own", () => {
    expect(
      BulkWholeResultSetEntrySchema.safeParse({
        query,
        action: { action: "archive" },
        ids: ["doc_a1b2c3"],
      }).success,
    ).toBe(false);
  });

  /** At most one, structurally: the field is singular, not a member of `entries`. */
  it("is a singular field rather than a list", () => {
    expect(
      BulkActionRequestSchema.safeParse(request([], [{ query, action: { action: "archive" } }]))
        .success,
    ).toBe(false);
  });
});

/**
 * SPEC.md §10: tagging "adds or removes the named tags and never replaces a
 * document's tag set". The delta has to be expressible, and the replacement has
 * to be *inexpressible* — a `tags: [...]` key that flattened twenty different
 * tag sets into one would be a silent data loss no response could report.
 */
describe("the tag act is a delta, and cannot be a replacement", () => {
  it.each([
    { action: "tag", add: ["q3"] },
    { action: "tag", remove: ["inbox"] },
    { action: "tag", add: ["q3"], remove: ["inbox"] },
  ])("expresses the delta %j", (action) => {
    expect(BulkActionRequestSchema.safeParse(one(action)).success).toBe(true);
  });

  it.each([
    { action: "tag", tags: ["q3"] },
    { action: "tag", set: ["q3"] },
    { action: "tag", replace: ["q3"] },
  ])("cannot express the replacement %j", (action) => {
    expect(BulkActionRequestSchema.safeParse(one(action)).success).toBe(false);
  });

  it.each([{ action: "tag" }, { action: "tag", add: [] }, { action: "tag", add: [], remove: [] }])(
    "refuses the empty delta %j, which would be a successful no-op",
    (action) => {
      const result = BulkActionRequestSchema.safeParse(one(action));
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("never replaces");
    },
  );

  it("rejects an empty tag name, which names nothing", () => {
    expect(BulkActionRequestSchema.safeParse(one({ action: "tag", add: [""] })).success).toBe(
      false,
    );
  });

  /** The restriction holds on the whole-result-set entry too, not only per row. */
  it("cannot express a replacement on a whole-result-set entry either", () => {
    expect(
      BulkWholeResultSetEntrySchema.safeParse({
        query: {},
        action: { action: "tag", tags: ["q3"] },
      }).success,
    ).toBe(false);
  });
});

describe("the three-part result (CONTRACT-037, per-document verbs from CONTRACT-048)", () => {
  const result = {
    changed: [{ id: "doc_a1b2c3", action: "archive" as const }],
    alreadyInState: [{ id: "doc_b2c3d4", action: "archive" as const }],
    refused: [
      {
        id: "th_x9y8",
        action: "resolve" as const,
        reason: "not-applicable" as const,
        message: "the corpus changed between staging and saving",
      },
    ],
    orphanedThreadIds: [],
    commit: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
    warnings: [],
  };

  it("populates all three parts independently", () => {
    const parsed = BulkActionResultSchema.parse(result);
    expect(parsed.changed).toEqual([{ id: "doc_a1b2c3", action: "archive" }]);
    expect(parsed.alreadyInState).toEqual([{ id: "doc_b2c3d4", action: "archive" }]);
    expect(parsed.refused).toHaveLength(1);
  });

  /**
   * The single top-level `action` echo is gone: a Save may carry a mix, so one
   * verb for the whole result would have been a lie. Each part names its own.
   */
  it("names the verb per document rather than once for the request", () => {
    const mixed = BulkActionResultSchema.parse({
      ...result,
      changed: [
        { id: "doc_a1b2c3", action: "archive" },
        { id: "th_x9y8", action: "resolve" },
      ],
      refused: [],
    });
    expect(mixed.changed.map((row) => row.action)).toEqual(["archive", "resolve"]);
    expect("action" in mixed).toBe(false);
    expect(BulkActionResultSchema.safeParse({ ...result, action: "archive" }).success).toBe(true);
  });

  it("rejects a bare id where an outcome belongs", () => {
    expect(BulkActionResultSchema.safeParse({ ...result, changed: ["doc_a1b2c3"] }).success).toBe(
      false,
    );
    expect(BulkActionOutcomeSchema.safeParse({ id: "doc_a1b2c3" }).success).toBe(false);
    expect(BulkActionOutcomeSchema.safeParse({ id: "doc_a1b2c3", action: "nope" }).success).toBe(
      false,
    );
  });

  /**
   * §10's "already in that state" is a no-op and explicitly not a failure, so
   * the two lists have to be able to disagree — a result that only ever filled
   * one of them would let a board render "17 archived" for 17 documents that
   * were archived yesterday.
   */
  it("keeps already-in-state distinct from changed and from refused", () => {
    const noop = BulkActionResultSchema.parse({
      ...result,
      changed: [],
      refused: [],
      commit: null,
    });
    expect(noop.alreadyInState).toEqual([{ id: "doc_b2c3d4", action: "archive" }]);
    expect(noop.changed).toEqual([]);
    // Nothing changed, so there is no commit: §4's commit contains exactly what
    // changed, and a commit containing nothing is not one.
    expect(noop.commit).toBeNull();
  });

  it("accepts the every-document-refused outcome as a 200-shaped result", () => {
    const parsed = BulkActionResultSchema.parse({
      ...result,
      changed: [],
      alreadyInState: [],
      commit: null,
    });
    expect(parsed.changed).toEqual([]);
    expect(parsed.refused).toHaveLength(1);
  });

  it("totals the threads a bulk delete orphaned", () => {
    const parsed = BulkActionResultSchema.parse({
      ...result,
      changed: [{ id: "doc_a1b2c3", action: "delete" }],
      orphanedThreadIds: ["th_x9y8", "th_a1b2"],
    });
    expect(parsed.orphanedThreadIds).toEqual(["th_x9y8", "th_a1b2"]);
  });

  it("carries §11 warnings, so a rejected auto-commit is visible", () => {
    const parsed = BulkActionResultSchema.parse({
      ...result,
      commit: null,
      warnings: [{ code: "commit_failed", detail: "pre-commit hook exited 1" }],
    });
    expect(parsed.warnings[0]?.code).toBe("commit_failed");
  });

  /** §4: a mix of verbs is still one act and still one commit — so, one sha. */
  it("names one commit, never a list", () => {
    expect(
      BulkActionResultSchema.safeParse({ ...result, commit: ["9f1c2ab", "a2b3c4d"] }).success,
    ).toBe(false);
  });
});

describe("a refusal names the document, the act, the reason and what to do about it", () => {
  const refusal = {
    id: "doc_a1b2c3",
    action: "archive" as const,
    reason: "invalid" as const,
    message: "…",
  };

  it("requires a reason on every entry", () => {
    expect(BulkActionRefusalSchema.safeParse({ id: "doc_a1b2c3", action: "archive" }).success).toBe(
      false,
    );
  });

  it("requires the act that was refused, so the entry reads on its own", () => {
    const { action: _action, ...withoutAction } = refusal;
    expect(BulkActionRefusalSchema.safeParse(withoutAction).success).toBe(false);
  });

  it("requires a non-empty message on every entry", () => {
    expect(BulkActionRefusalSchema.safeParse({ ...refusal, message: "" }).success).toBe(false);
    const { message: _message, ...withoutMessage } = refusal;
    expect(BulkActionRefusalSchema.safeParse(withoutMessage).success).toBe(false);
  });

  /**
   * `stale` replaced `locked` when the lock did (SHARED-041). What a person does
   * about it changed with it: there is no holder to wait for, so the class alone
   * has to carry "look at what it says now", and the message carries the rest.
   */
  it("no longer carries a staleness refusal, which had no producer", () => {
    // `locked` became `stale` when SHARED-041 replaced the lock with a key, and
    // `stale` was kept on the strength of a §10 sentence struck on 2026-08-13
    // (PR #46 review). Nothing ever emitted it and nothing can: every act this
    // route offers names its own delta, so the request carries no key and the
    // route has no version to compare. A declared class with no producer invites
    // a `case "stale":` recovery that can never run.
    expect(BulkActionRefusalSchema.safeParse({ ...refusal, reason: "stale" }).success).toBe(false);
  });

  /**
   * The reason is refused outright; the holder is merely dropped, because a
   * response schema is tolerant by policy (CONTRACT-017) — what matters is that
   * a client can no longer read a holder off a refusal, not that a server that
   * still sends one is punished for it.
   */
  it("no longer accepts the removed lock refusal, and drops a holder sent beside one", () => {
    expect(BulkActionRefusalSchema.safeParse({ ...refusal, reason: "locked" }).success).toBe(false);
    const parsed = BulkActionRefusalSchema.parse({
      ...refusal,
      lock: { docId: "doc_a1b2c3", holder: "agent", acquired: "2026-07-19T10:05:00Z", ttl: 300 },
    });
    expect(parsed).not.toHaveProperty("lock");
  });

  it("distinguishes an unknown id from an inapplicable act and from a validation failure", () => {
    // Exactly the classes the route can produce, and no more — the enum is what
    // a client branches on, so a value with no producer is a dead branch.
    expect([...BULK_REFUSAL_REASONS]).toEqual([
      "not-found",
      "not-applicable",
      "invalid",
      "write-failed",
    ]);
    for (const reason of BULK_REFUSAL_REASONS) {
      expect(BulkActionRefusalSchema.safeParse({ ...refusal, reason }).success, reason).toBe(true);
    }
  });

  /** Each document is named individually, with its own reason and its own message. */
  it("names a different reason per document", () => {
    const parsed = BulkActionResultSchema.parse({
      changed: [],
      alreadyInState: [],
      refused: [
        {
          id: "doc_a1b2c3",
          action: "archive",
          reason: "invalid",
          message: "it would not validate",
        },
        { id: "th_x9y8", action: "resolve", reason: "not-found", message: "no such thread" },
      ],
      orphanedThreadIds: [],
      commit: null,
      warnings: [],
    });
    expect(parsed.refused.map((row) => row.reason)).toEqual(["invalid", "not-found"]);
    expect(parsed.refused.map((row) => row.action)).toEqual(["archive", "resolve"]);
  });
});
