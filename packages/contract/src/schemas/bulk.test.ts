import { describe, expect, it } from "vitest";
import {
  BULK_ACTION_NAMES,
  BULK_REFUSAL_REASONS,
  BulkActionRefusalSchema,
  BulkActionRequestSchema,
  BulkActionResultSchema,
} from "./bulk.js";

const IDS = ["doc_a1b2c3", "th_x9y8"];

const request = (action: unknown, ids: unknown = IDS): unknown => ({ ids, action });

const lock = {
  docId: "doc_a1b2c3",
  holder: "agent" as const,
  acquired: "2026-07-19T10:05:00Z",
  ttl: 300,
};

describe("the bulk action request (CONTRACT-037)", () => {
  it("carries several ids and one act", () => {
    const parsed = BulkActionRequestSchema.parse(request({ action: "archive" }));
    expect(parsed.ids).toEqual(IDS);
    expect(parsed.action.action).toBe("archive");
  });

  /** An act on nothing is a caller bug; a `200` with three empty lists hides it. */
  it("rejects an empty id list", () => {
    expect(BulkActionRequestSchema.safeParse(request({ action: "archive" }, [])).success).toBe(
      false,
    );
  });

  /**
   * Duplicates are collapsed by the server, not refused by the schema: a board
   * that lists the same document in two rows of one column has not made an error
   * the user can act on, and the result names each id once either way.
   */
  it("accepts the same id twice rather than refusing the request", () => {
    const parsed = BulkActionRequestSchema.parse(
      request({ action: "archive" }, ["doc_a1b2c3", "doc_a1b2c3"]),
    );
    expect(parsed.ids).toEqual(["doc_a1b2c3", "doc_a1b2c3"]);
  });

  it("validates every id against the document id grammar", () => {
    expect(
      BulkActionRequestSchema.safeParse(request({ action: "archive" }, ["doc_a1b2c3", "nope"]))
        .success,
    ).toBe(false);
    expect(
      BulkActionRequestSchema.safeParse(request({ action: "archive" }, ["evt_7c1d"])).success,
    ).toBe(false);
  });

  it("threads are documents, so thread ids need no separate route", () => {
    expect(
      BulkActionRequestSchema.safeParse(request({ action: "resolve" }, ["th_x9y8", "th_a1"]))
        .success,
    ).toBe(true);
  });

  it("rejects an act it does not declare", () => {
    expect(BulkActionRequestSchema.safeParse(request({ action: "publish" })).success).toBe(false);
    expect(BulkActionRequestSchema.safeParse(request({})).success).toBe(false);
  });

  it("offers exactly SPEC.md §11's selection actions, minus the one that changes nothing", () => {
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

  /** Strict, like every request body (CONTRACT-017). */
  it.each([
    { ids: IDS, action: { action: "archive" }, actor: "user" },
    { ids: IDS, action: { action: "archive", folder: "finance" } },
    { ids: IDS, action: { action: "move" } },
    { ids: IDS, action: { action: "move", folder: "finance", tags: ["q3"] } },
  ])("rejects the malformed body %j before any handler runs", (body) => {
    expect(BulkActionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("takes a destination folder on a move", () => {
    const parsed = BulkActionRequestSchema.parse(request({ action: "move", folder: "finance" }));
    expect(parsed.action).toEqual({ action: "move", folder: "finance" });
  });
});

/**
 * SPEC.md §11: tagging "adds or removes the named tags and never replaces a
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
    expect(BulkActionRequestSchema.safeParse(request(action)).success).toBe(true);
  });

  it.each([
    { action: "tag", tags: ["q3"] },
    { action: "tag", set: ["q3"] },
    { action: "tag", replace: ["q3"] },
  ])("cannot express the replacement %j", (action) => {
    expect(BulkActionRequestSchema.safeParse(request(action)).success).toBe(false);
  });

  it.each([{ action: "tag" }, { action: "tag", add: [] }, { action: "tag", add: [], remove: [] }])(
    "refuses the empty delta %j, which would be a successful no-op",
    (action) => {
      const result = BulkActionRequestSchema.safeParse(request(action));
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("never replaces");
    },
  );

  it("rejects an empty tag name, which names nothing", () => {
    expect(BulkActionRequestSchema.safeParse(request({ action: "tag", add: [""] })).success).toBe(
      false,
    );
  });
});

describe("the three-part result (CONTRACT-037)", () => {
  const result = {
    action: "archive" as const,
    changed: ["doc_a1b2c3"],
    alreadyInState: ["doc_b2c3d4"],
    refused: [
      { id: "th_x9y8", reason: "locked" as const, message: "held by the agent until 10:10", lock },
    ],
    orphanedThreadIds: [],
    commit: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
    warnings: [],
  };

  it("populates all three parts independently", () => {
    const parsed = BulkActionResultSchema.parse(result);
    expect(parsed.changed).toEqual(["doc_a1b2c3"]);
    expect(parsed.alreadyInState).toEqual(["doc_b2c3d4"]);
    expect(parsed.refused).toHaveLength(1);
  });

  /**
   * §11's "already in that state" is a no-op and explicitly not a failure, so
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
    expect(noop.alreadyInState).toEqual(["doc_b2c3d4"]);
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
      action: "delete" as const,
      orphanedThreadIds: ["th_x9y8", "th_a1b2"],
    });
    expect(parsed.orphanedThreadIds).toEqual(["th_x9y8", "th_a1b2"]);
  });

  it("carries §14 warnings, so a rejected auto-commit is visible", () => {
    const parsed = BulkActionResultSchema.parse({
      ...result,
      commit: null,
      warnings: [{ code: "commit_failed", detail: "pre-commit hook exited 1" }],
    });
    expect(parsed.warnings[0]?.code).toBe("commit_failed");
  });

  it("names one commit, never a list", () => {
    expect(
      BulkActionResultSchema.safeParse({ ...result, commit: ["9f1c2ab", "a2b3c4d"] }).success,
    ).toBe(false);
  });
});

describe("a refusal names the document, the reason, and — for a lock — the holder", () => {
  const refusal = { id: "doc_a1b2c3", reason: "invalid" as const, message: "…", lock: null };

  it("requires a reason on every entry", () => {
    expect(BulkActionRefusalSchema.safeParse({ id: "doc_a1b2c3", lock: null }).success).toBe(false);
  });

  it("requires a non-empty message on every entry", () => {
    expect(BulkActionRefusalSchema.safeParse({ ...refusal, message: "" }).success).toBe(false);
    expect(
      BulkActionRefusalSchema.safeParse({ id: "doc_a1b2c3", reason: "invalid", lock: null })
        .success,
    ).toBe(false);
  });

  it("carries the holder on a lock refusal (SPEC.md §7)", () => {
    const parsed = BulkActionRefusalSchema.parse({
      ...refusal,
      reason: "locked",
      message: "held by the agent",
      lock,
    });
    expect(parsed.lock?.holder).toBe("agent");
  });

  it("refuses a lock refusal that names no holder", () => {
    expect(
      BulkActionRefusalSchema.safeParse({ ...refusal, reason: "locked", lock: null }).success,
    ).toBe(false);
  });

  it("refuses a holder on a reason that is not a lock", () => {
    expect(BulkActionRefusalSchema.safeParse({ ...refusal, lock }).success).toBe(false);
  });

  it("distinguishes an unknown id from a lock and from a validation failure", () => {
    expect([...BULK_REFUSAL_REASONS]).toEqual([
      "locked",
      "not-found",
      "not-applicable",
      "invalid",
      "write-failed",
    ]);
    for (const reason of BULK_REFUSAL_REASONS) {
      const entry = { ...refusal, reason, ...(reason === "locked" ? { lock } : {}) };
      expect(BulkActionRefusalSchema.safeParse(entry).success, reason).toBe(true);
    }
  });

  /** Mixed holders: each document is named individually, with its own lock. */
  it("names a different holder per document", () => {
    const parsed = BulkActionResultSchema.parse({
      action: "archive",
      changed: [],
      alreadyInState: [],
      refused: [
        { id: "doc_a1b2c3", reason: "locked", message: "agent", lock },
        {
          id: "th_x9y8",
          reason: "locked",
          message: "user",
          lock: { ...lock, docId: "th_x9y8", holder: "user" },
        },
      ],
      orphanedThreadIds: [],
      commit: null,
      warnings: [],
    });
    expect(parsed.refused.map((entry) => entry.lock?.holder)).toEqual(["agent", "user"]);
  });
});
