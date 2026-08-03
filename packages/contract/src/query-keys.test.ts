import { describe, expect, it } from "vitest";
import { QueryKeySchema } from "./schemas/sse.js";
import {
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  LOCKS_KEY,
  QUERY_KEY_NAMES,
  QUERY_KEY_VOCABULARY,
  QUEUE_KEY,
  TREE_KEY,
  describeQueryKeyVocabulary,
  docKey,
  jobKey,
  lockKey,
  threadKey,
} from "./query-keys.js";

/** Representative ids, one per parameterised shape, in vocabulary order. */
const SAMPLE_IDS: Readonly<Record<string, string>> = {
  doc: "doc_a1b2c3",
  thread: "th_x9y8",
  job: "evt_7c1d",
  lock: "doc_a1b2c3",
};

describe("the published query-key vocabulary", () => {
  /**
   * The set SERVER-007's emitter records. Written out literally rather than
   * derived from the module, because a test that computes its expectation from
   * the thing it is testing pins nothing.
   */
  it("is exactly the ten shapes the server emits", () => {
    const shapes = QUERY_KEY_NAMES.map((name) => QUERY_KEY_VOCABULARY[name].shape);
    expect(shapes).toEqual([
      '["docs"]',
      '["docs", "<docId|threadId>"]',
      '["tree"]',
      '["threads", "<threadId>"]',
      '["queue"]',
      '["jobs"]',
      '["jobs", "<eventId>"]',
      '["locks"]',
      '["locks", "<docId>"]',
      '["index"]',
    ]);
  });

  /**
   * Closed by assertion, not by convention: adding an eleventh entry to the
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
      "locks",
      "lock",
      "index",
    ]);
  });

  it("builds every key the exported constants and helpers build", () => {
    expect(QUERY_KEY_VOCABULARY.docs.key("ignored")).toEqual(DOCS_KEY);
    expect(QUERY_KEY_VOCABULARY.tree.key("ignored")).toEqual(TREE_KEY);
    expect(QUERY_KEY_VOCABULARY.queue.key("ignored")).toEqual(QUEUE_KEY);
    expect(QUERY_KEY_VOCABULARY.jobs.key("ignored")).toEqual(JOBS_KEY);
    expect(QUERY_KEY_VOCABULARY.locks.key("ignored")).toEqual(LOCKS_KEY);
    expect(QUERY_KEY_VOCABULARY.index.key("ignored")).toEqual(INDEX_KEY);
    expect(QUERY_KEY_VOCABULARY.doc.key("doc_a1b2c3")).toEqual(docKey("doc_a1b2c3"));
    expect(QUERY_KEY_VOCABULARY.thread.key("th_x9y8")).toEqual(threadKey("th_x9y8"));
    expect(QUERY_KEY_VOCABULARY.job.key("evt_7c1d")).toEqual(jobKey("evt_7c1d"));
    expect(QUERY_KEY_VOCABULARY.lock.key("doc_a1b2c3")).toEqual(lockKey("doc_a1b2c3"));
  });

  it("names each key literally the way an `invalidate` frame carries it", () => {
    expect(DOCS_KEY).toEqual(["docs"]);
    expect(TREE_KEY).toEqual(["tree"]);
    expect(QUEUE_KEY).toEqual(["queue"]);
    expect(JOBS_KEY).toEqual(["jobs"]);
    expect(LOCKS_KEY).toEqual(["locks"]);
    expect(INDEX_KEY).toEqual(["index"]);
    expect(docKey("th_x9y8")).toEqual(["docs", "th_x9y8"]);
    expect(threadKey("th_x9y8")).toEqual(["threads", "th_x9y8"]);
    expect(jobKey("evt_7c1d")).toEqual(["jobs", "evt_7c1d"]);
    expect(lockKey("doc_a1b2c3")).toEqual(["locks", "doc_a1b2c3"]);
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

  it("flags exactly the four parameterised shapes", () => {
    const parameterised = QUERY_KEY_NAMES.filter(
      (name) => QUERY_KEY_VOCABULARY[name].parameterised,
    );
    expect(parameterised).toEqual(["doc", "thread", "job", "lock"]);
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
