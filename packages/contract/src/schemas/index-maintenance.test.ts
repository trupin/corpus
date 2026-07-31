import { describe, expect, it } from "vitest";
import { IndexStatusSchema, type IndexStatus } from "./index-maintenance.js";
import { SEMANTIC_INDEX_STATES, SemanticIndexStateSchema } from "./retrieval.js";

/**
 * The five workspaces `GET /api/index/status` has to be able to describe, named
 * once here so SERVER-046's handler tests and CLI-020's rendering tests can be
 * written against the same five situations rather than five different ones.
 *
 * Each is the *whole* wire object, not a partial: the point of the fixture is
 * that the counts, the identity, the flag and the state word agree with each
 * other under the mapping the schema publishes, so a fixture that could not
 * occur in a real workspace never becomes the thing an implementation is written
 * against.
 */
const IDENTITY = "ollama/nomic-embed-text@768";

/** Nothing configured, nothing indexed: lexical ranking, and the honest word for it. */
const FRESH: IndexStatus = {
  indexed: 0,
  pending: 0,
  failed: 0,
  identity: null,
  rebuilding: false,
  state: "disabled",
};

/** An incremental backlog draining behind a save — `pending > 0`, no rebuild. */
const DRAINING: IndexStatus = {
  indexed: 120,
  pending: 34,
  failed: 0,
  identity: IDENTITY,
  rebuilding: false,
  state: "stale",
};

/** Everything re-queued by `POST /api/index/rebuild`: `indexing` outranks `stale`. */
const REBUILDING: IndexStatus = {
  indexed: 0,
  pending: 154,
  failed: 0,
  identity: IDENTITY,
  rebuilding: true,
  state: "indexing",
};

/** Caught up: the only state in which ranking is not degraded. */
const CAUGHT_UP: IndexStatus = {
  indexed: 154,
  pending: 0,
  failed: 0,
  identity: IDENTITY,
  rebuilding: false,
  state: "current",
};

/**
 * Failures do not move the state word, and that is deliberate: they are not a
 * backlog (nothing is draining) and they are not a missing index (ranking works).
 * They are a number a person has to look at, which is the whole reason `failed`
 * is a field instead of being folded into `pending`.
 */
const WITH_FAILURES: IndexStatus = {
  indexed: 151,
  pending: 0,
  failed: 3,
  identity: IDENTITY,
  rebuilding: false,
  state: "current",
};

const FIXTURES: ReadonlyArray<readonly [string, IndexStatus]> = [
  ["a fresh workspace", FRESH],
  ["a draining backlog", DRAINING],
  ["a full rebuild in flight", REBUILDING],
  ["a caught-up index", CAUGHT_UP],
  ["an index with permanent failures", WITH_FAILURES],
];

describe("the index status shape", () => {
  it("is counts, identity, the rebuild flag and one derived word — in that order", () => {
    expect(Object.keys(IndexStatusSchema.shape)).toEqual([
      "indexed",
      "pending",
      "failed",
      "identity",
      "rebuilding",
      "state",
    ]);
  });

  it.each(FIXTURES)("round-trips %s", (_name, fixture) => {
    expect(IndexStatusSchema.parse(fixture)).toEqual(fixture);
    // Through JSON as well: this object exists to cross a wire, and `identity`
    // is the one field with a value (`null`) that a sloppier encoding could lose.
    expect(IndexStatusSchema.parse(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  });

  it("requires every field, since an absent count is not a smaller number", () => {
    for (const key of Object.keys(IndexStatusSchema.shape)) {
      const partial: Record<string, unknown> = { ...CAUGHT_UP };
      delete partial[key];
      expect(IndexStatusSchema.safeParse(partial).success, key).toBe(false);
    }
  });

  it("takes a null identity but never an empty one", () => {
    expect(IndexStatusSchema.parse({ ...FRESH, identity: null }).identity).toBeNull();
    expect(IndexStatusSchema.safeParse({ ...FRESH, identity: "" }).success).toBe(false);
  });

  it.each(["indexed", "pending", "failed"])("keeps %s a non-negative integer", (field) => {
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, [field]: -1 }).success).toBe(false);
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, [field]: 1.5 }).success).toBe(false);
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, [field]: "12" }).success).toBe(false);
  });

  /**
   * The one-vocabulary invariant, asserted rather than reviewed: `state` is the
   * *same* schema `/api/search` and `/api/docs/{id}/related` carry, so the four
   * values cannot drift apart across the three surfaces. A fifth value invented
   * for this endpoint would fail here — and C3 of sprint-021 is explicit that
   * `catching-up` and `lexical-only`, which three issue files name, do not exist.
   */
  it("reuses the frozen retrieval enum rather than declaring a second one", () => {
    for (const value of SEMANTIC_INDEX_STATES) {
      expect(IndexStatusSchema.parse({ ...CAUGHT_UP, state: value }).state).toBe(value);
      expect(SemanticIndexStateSchema.parse(value)).toBe(value);
    }
    for (const invented of ["catching-up", "lexical-only", "ok"]) {
      expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, state: invented }).success).toBe(false);
    }
  });

  /**
   * A response schema, so it follows the contract's tolerant-reads posture: the
   * strict-body rule in `./index.ts` is about request bodies, and a client that
   * runtime-parses a response from a newer server must not fail on a field it
   * has not heard of.
   */
  it("ignores an unknown field rather than rejecting a newer server's response", () => {
    const parsed = IndexStatusSchema.parse({ ...CAUGHT_UP, chunksPerSecond: 42 });
    expect(parsed).toEqual(CAUGHT_UP);
  });
});

describe("the published mapping from facts to the state word", () => {
  const description = IndexStatusSchema.shape.state.description ?? "";

  /**
   * The mapping is the contract — SERVER-045 and SERVER-046 derive `state` from
   * these facts, and CLI-020 explains a degraded ranking with it — so it is
   * published where an implementer and a client author both read it, and pinned
   * here so an edit is a deliberate act.
   */
  it.each([
    ["`current` — an identity is recorded and `pending` is 0 with no rebuild in flight"],
    ["`indexing` — `rebuilding` is true, which outranks `stale`"],
    ["`stale` — an incremental backlog only (`pending > 0`, no rebuild in flight)"],
    ["`disabled` — no provider resolved, no recorded identity, or no usable vectors"],
  ])("states the rule for %s", (rule) => {
    expect(description).toContain(rule);
  });

  it("says the word is derived, not stored, so nobody persists a sixth source of truth", () => {
    expect(description).toContain("Derived from the fields above rather than stored");
  });

  it("explains why the field is required here and optional on the retrieval envelopes", () => {
    expect(description).toContain("Required here");
    expect(description).toContain("this response *is* the claim");
  });

  it("publishes the identity's form and its stickiness where a client would parse it", () => {
    const identity = IndexStatusSchema.shape.identity.description ?? "";
    expect(identity).toContain("never parsed");
    expect(identity).toContain("provider/model@dim");
    expect(identity).toContain("sticky");
  });

  it("says a backlog is staleness and not drift, which is what keeps doctor clean", () => {
    expect(IndexStatusSchema.shape.pending.description).toContain("staleness, not drift");
  });
});
