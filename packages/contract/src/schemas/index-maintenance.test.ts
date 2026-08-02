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

/**
 * A first run, mid-download. The state word is `disabled` and that is honest —
 * nothing can embed yet — so the sentence is the only thing separating this
 * workspace from one that will never have a model.
 */
const DOWNLOADING: IndexStatus = {
  indexed: 0,
  pending: 81,
  failed: 0,
  identity: null,
  rebuilding: false,
  state: "disabled",
  detail:
    "downloading the all-MiniLM-L6-v2 embedding model (10.4 MiB of 22.6 MiB, 46%) — " +
    "semantic ranking starts once it is cached",
};

const FIXTURES: ReadonlyArray<readonly [string, IndexStatus]> = [
  ["a fresh workspace", FRESH],
  ["a draining backlog", DRAINING],
  ["a full rebuild in flight", REBUILDING],
  ["a caught-up index", CAUGHT_UP],
  ["an index with permanent failures", WITH_FAILURES],
  ["a model still downloading", DOWNLOADING],
];

/** The six fields every payload carries; `detail` is the seventh and is optional. */
const REQUIRED_FIELDS = [
  "indexed",
  "pending",
  "failed",
  "identity",
  "rebuilding",
  "state",
] as const;

describe("the index status shape", () => {
  it("is counts, identity, the rebuild flag, one derived word and the sentence beside it", () => {
    expect(Object.keys(IndexStatusSchema.shape)).toEqual([...REQUIRED_FIELDS, "detail"]);
  });

  it.each(FIXTURES)("round-trips %s", (_name, fixture) => {
    expect(IndexStatusSchema.parse(fixture)).toEqual(fixture);
    // Through JSON as well: this object exists to cross a wire, and `identity`
    // is the one field with a value (`null`) that a sloppier encoding could lose.
    expect(IndexStatusSchema.parse(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  });

  it("requires every counted field, since an absent count is not a smaller number", () => {
    for (const key of REQUIRED_FIELDS) {
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

/**
 * The 2026-08-01 rider. SERVER-048 promised "downloads happen lazily on first
 * index need, with progress visible in `index status`" and the payload had no
 * field that could carry it, so a 22.6 MiB first-run download rendered as a bare
 * `disabled` — the same six fields, byte-identical, from 0% to 100% (the
 * SERVER-048 evaluation, FAIL-1). One optional string closes that, and the
 * constraint it is written under is that it closes *only* that: the state enum
 * is frozen (C3), so the sentence sits beside the word instead of becoming one.
 */
describe("the `detail` sentence", () => {
  it("is omissible, and parsing never invents one", () => {
    const parsed = IndexStatusSchema.parse(CAUGHT_UP);
    expect("detail" in parsed).toBe(false);
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, detail: undefined }).success).toBe(true);
  });

  it("carries the download sentence through the wire unchanged", () => {
    const parsed = IndexStatusSchema.parse(JSON.parse(JSON.stringify(DOWNLOADING)));
    expect(parsed.detail).toBe(DOWNLOADING.detail);
    expect(parsed.state).toBe("disabled");
  });

  it("refuses an empty sentence, because absence already means nothing to say", () => {
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, detail: "" }).success).toBe(false);
    expect(IndexStatusSchema.safeParse({ ...CAUGHT_UP, detail: 42 }).success).toBe(false);
  });

  it("does not touch the state enum, which stays the four signed values", () => {
    expect([...SEMANTIC_INDEX_STATES]).toEqual(["current", "indexing", "stale", "disabled"]);
    expect(IndexStatusSchema.safeParse({ ...DOWNLOADING, state: "downloading" }).success).toBe(
      false,
    );
  });

  it("tells a client to render it and decide on `state` instead", () => {
    const description = IndexStatusSchema.shape.detail.description ?? "";
    expect(description).toContain("Rendered, never parsed");
    expect(description).toContain("Absent when there is nothing to add");
  });
});
