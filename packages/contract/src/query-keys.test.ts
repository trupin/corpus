import { describe, expect, it } from "vitest";
import { QueryKeySchema } from "./schemas/sse.js";
import {
  AGENTS_KEY,
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  QUERY_KEY_NAMES,
  QUERY_KEY_VOCABULARY,
  QUEUE_KEY,
  TREE_KEY,
  describeQueryKeyVocabulary,
  docKey,
  jobKey,
  threadKey,
} from "./query-keys.js";

/** Representative ids, one per parameterised shape, in vocabulary order. */
const SAMPLE_IDS: Readonly<Record<string, string>> = {
  doc: "doc_a1b2c3",
  thread: "th_x9y8",
  job: "evt_7c1d",
};

describe("the published query-key vocabulary", () => {
  /**
   * The set SERVER-007's emitter records. Written out literally rather than
   * derived from the module, because a test that computes its expectation from
   * the thing it is testing pins nothing.
   */
  it("is exactly the nine shapes the server emits", () => {
    const shapes = QUERY_KEY_NAMES.map((name) => QUERY_KEY_VOCABULARY[name].shape);
    expect(shapes).toEqual([
      '["docs"]',
      '["docs", "<docId|threadId>"]',
      '["tree"]',
      '["threads", "<threadId>"]',
      '["queue"]',
      '["jobs"]',
      '["jobs", "<eventId>"]',
      '["index"]',
      '["agents"]',
    ]);
  });

  /**
   * Closed by assertion, not by convention: adding a tenth entry to the
   * record without adding it here fails, naming the newcomer.
   */
  it("is a closed set — the record and the pinned name list agree", () => {
    expect(Object.keys(QUERY_KEY_VOCABULARY)).toEqual([...QUERY_KEY_NAMES]);
    expect(QUERY_KEY_NAMES).toEqual([
      "docs",
      "doc",
      "tree",
      "thread",
      "queue",
      "jobs",
      "job",
      "index",
      "agents",
    ]);
  });

  it("builds every key the exported constants and helpers build", () => {
    expect(QUERY_KEY_VOCABULARY.docs.key("ignored")).toEqual(DOCS_KEY);
    expect(QUERY_KEY_VOCABULARY.tree.key("ignored")).toEqual(TREE_KEY);
    expect(QUERY_KEY_VOCABULARY.queue.key("ignored")).toEqual(QUEUE_KEY);
    expect(QUERY_KEY_VOCABULARY.jobs.key("ignored")).toEqual(JOBS_KEY);
    expect(QUERY_KEY_VOCABULARY.index.key("ignored")).toEqual(INDEX_KEY);
    expect(QUERY_KEY_VOCABULARY.agents.key("ignored")).toEqual(AGENTS_KEY);
    expect(QUERY_KEY_VOCABULARY.doc.key("doc_a1b2c3")).toEqual(docKey("doc_a1b2c3"));
    expect(QUERY_KEY_VOCABULARY.thread.key("th_x9y8")).toEqual(threadKey("th_x9y8"));
    expect(QUERY_KEY_VOCABULARY.job.key("evt_7c1d")).toEqual(jobKey("evt_7c1d"));
  });

  it("names each key literally the way an `invalidate` frame carries it", () => {
    expect(DOCS_KEY).toEqual(["docs"]);
    expect(TREE_KEY).toEqual(["tree"]);
    expect(QUEUE_KEY).toEqual(["queue"]);
    expect(JOBS_KEY).toEqual(["jobs"]);
    expect(INDEX_KEY).toEqual(["index"]);
    expect(AGENTS_KEY).toEqual(["agents"]);
    expect(docKey("th_x9y8")).toEqual(["docs", "th_x9y8"]);
    expect(threadKey("th_x9y8")).toEqual(["threads", "th_x9y8"]);
    expect(jobKey("evt_7c1d")).toEqual(["jobs", "evt_7c1d"]);
  });

  /**
   * `createEventStream` validates every frame it receives, so a helper that
   * returned a bare string would be rejected at runtime rather than at review.
   */
  it("produces only valid QueryKeys", () => {
    for (const name of QUERY_KEY_NAMES) {
      const built = QUERY_KEY_VOCABULARY[name].key(SAMPLE_IDS[name] ?? "ignored");
      expect(QueryKeySchema.safeParse(built).success, name).toBe(true);
      expect(Array.isArray(built), name).toBe(true);
      expect(built.length, name).toBeGreaterThan(0);
    }
  });

  it("hands back a fresh array, so an exported constant cannot be mutated through it", () => {
    const first = QUERY_KEY_VOCABULARY.docs.key("ignored");
    first.push("mutated");
    expect(DOCS_KEY).toEqual(["docs"]);
    expect(QUERY_KEY_VOCABULARY.docs.key("ignored")).toEqual(["docs"]);
  });

  it("flags exactly the three parameterised shapes", () => {
    const parameterised = QUERY_KEY_NAMES.filter(
      (name) => QUERY_KEY_VOCABULARY[name].parameterised,
    );
    expect(parameterised).toEqual(["doc", "thread", "job"]);
  });

  /**
   * The whole point of publishing the vocabulary: UI-002 must not have to
   * re-derive "what emits this, and what refetches on it" from server source.
   */
  it("documents an emitter and a consumer for every shape", () => {
    for (const name of QUERY_KEY_NAMES) {
      const entry = QUERY_KEY_VOCABULARY[name];
      expect(entry.emittedBy.length, `${name}.emittedBy`).toBeGreaterThan(10);
      expect(entry.refetchedBy.length, `${name}.refetchedBy`).toBeGreaterThan(10);
    }
  });

  it("renders one description line per shape, in vocabulary order", () => {
    const lines = describeQueryKeyVocabulary().split("\n");
    expect(lines).toHaveLength(QUERY_KEY_NAMES.length);
    for (const [index, name] of QUERY_KEY_NAMES.entries()) {
      const entry = QUERY_KEY_VOCABULARY[name];
      expect(lines[index]).toContain(entry.shape);
      expect(lines[index]).toContain(entry.emittedBy);
      expect(lines[index]).toContain(entry.refetchedBy);
    }
  });

  it("is byte-stable across calls, which is what keeps `openapi.json` stable", () => {
    expect(describeQueryKeyVocabulary()).toBe(describeQueryKeyVocabulary());
  });
});

/**
 * CONTRACT-055 — a key is emitted by the writes that stale it, not by the
 * writes named after it.
 *
 * SERVER-114 established the rule (*an emit names every key a route carrying
 * the changed fact is cached under, not the key of the route the fact is named
 * after*) and its sweep found seven emitters that change the roster without
 * naming `["agents"]`. `SERVER-115` fixes them; this is the half that has to be
 * published first, or the server ships a frame the contract's own description
 * denies.
 *
 * These assertions are about **what the description says**, which is all this
 * package can see: `packages/contract` does not import `apps/server` and must
 * not, so the vocabulary cannot be held against the actual emitters from here.
 * The cross-check that would catch a *server* drifting from this prose has to
 * live in `apps/server`, over its event bus — recorded in CONTRACT-055's log,
 * and not silently implied by anything below.
 */
describe("keys the roster is invalidated by (CONTRACT-055)", () => {
  /** Entries that tell a reader a frame of theirs also carries `["agents"]`. */
  const crossReferencing = QUERY_KEY_NAMES.filter((name) =>
    QUERY_KEY_VOCABULARY[name].emittedBy.includes('`["agents"]`'),
  );

  it("names the writes that stale the roster among the roster key's emitters", () => {
    const { emittedBy } = QUERY_KEY_VOCABULARY.agents;
    for (const emitter of [
      "queue transition",
      "job-log append",
      "out of band",
      "designated root thread being retitled or deleted",
      "projection rebuild",
    ]) {
      expect(emittedBy, emitter).toContain(emitter);
    }
  });

  /**
   * The clause the issue exists for. A description that states the coupling
   * without the derivation behind it leaves the next reader to rediscover it,
   * and rediscovering it is what cost this release two issues.
   */
  it("says why a queue write changes an agents read, not only that it does", () => {
    const { emittedBy } = QUERY_KEY_VOCABULARY.agents;
    expect(emittedBy).toContain("a lane row is computed at read time and never stored");
    expect(emittedBy).toContain("`events` and `jobs` rows");
    expect(emittedBy).toContain("whenever it writes a row the roster reads");
  });

  /**
   * `AgentLane.summary` promises its bound and refuses to promise its content,
   * so the reason given here must not read as a second, contradicting promise.
   */
  it("gives the derivation as a reason without promising it", () => {
    expect(QUERY_KEY_VOCABULARY.agents.emittedBy).toContain(
      "The derivation itself may change without a contract change",
    );
    expect(QUERY_KEY_VOCABULARY.agents.emittedBy).toContain("the invalidation may not");
  });

  /**
   * Stated in both directions, and pinned in both: a reader who arrives at the
   * queue entry from a queue transition must learn the coupling there, and a
   * reader of the roster entry must find the same emitters listed back. Half an
   * update is exactly how CONTRACT-052's stale descriptions survived.
   */
  it("cross-references the roster from every entry a roster-staling write also names", () => {
    expect(crossReferencing).toEqual(["queue", "jobs"]);
    for (const name of crossReferencing) {
      expect(QUERY_KEY_VOCABULARY[name].emittedBy, name).toContain("a lane row of the roster");
      expect(QUERY_KEY_VOCABULARY[name].emittedBy, name).toContain("derived from");
    }
    // …and the roster entry names those same two families back.
    expect(QUERY_KEY_VOCABULARY.agents.emittedBy).toContain(
      "a queue transition or a job-log append",
    );
  });

  /**
   * The rebuild is the same defect shape found by this issue's own sweep: it is
   * named after the projection and emits four keys named after other resources,
   * and until now no entry said so.
   */
  it("names the projection rebuild on every key the rebuild emits", () => {
    for (const name of ["docs", "tree", "queue", "jobs", "agents"] as const) {
      expect(QUERY_KEY_VOCABULARY[name].emittedBy, name).toContain("projection rebuild");
    }
  });

  /**
   * The other find: a queue transition carries `["docs"]` because `failed-job`
   * is a `needs=` reason computed from `events.status` (SERVER-028). Shipped
   * behaviour that the published vocabulary described only under `["queue"]`.
   */
  it("names queue transitions among the document collection's emitters", () => {
    expect(QUERY_KEY_VOCABULARY.docs.emittedBy).toContain("every queue transition");
    expect(QUERY_KEY_VOCABULARY.docs.emittedBy).toContain("needs=failed-job");
  });
});
