import { describe, expect, it } from "vitest";
import { InvalidatePayloadSchema, QueryKeySchema } from "@corpus/contract";
import {
  DOCS_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  dedupeKeys,
  docKey,
  jobKey,
  threadKey,
} from "./keys.js";

const VOCABULARY = [
  DOCS_KEY,
  docKey("doc_a1b2c3"),
  TREE_KEY,
  threadKey("th_d4e5f6"),
  QUEUE_KEY,
  JOBS_KEY,
  jobKey("evt_9z8y7x"),
];

describe("the invalidation key vocabulary", () => {
  it.each(VOCABULARY.map((key) => [key]))(
    "%j is a QueryKey — an array, never a bare string",
    (key) => {
      expect(Array.isArray(key)).toBe(true);
      expect(QueryKeySchema.safeParse(key).success).toBe(true);
    },
  );

  it("spells one segment per path component", () => {
    expect(VOCABULARY).toEqual([
      ["docs"],
      ["docs", "doc_a1b2c3"],
      ["tree"],
      ["threads", "th_d4e5f6"],
      ["queue"],
      ["jobs"],
      ["jobs", "evt_9z8y7x"],
    ]);
  });

  it("forms a payload the shipped consumer accepts", () => {
    expect(InvalidatePayloadSchema.safeParse({ keys: VOCABULARY }).success).toBe(true);
    // The flat-string spelling the issue's first draft used is rejected by the
    // contract's own schema, so it would never reach the UI (Adjudication 1).
    expect(InvalidatePayloadSchema.safeParse({ keys: ["docs/doc_a1b2c3"] }).success).toBe(false);
  });
});

describe("dedupeKeys", () => {
  it("collapses structurally identical keys, keeping first-seen order", () => {
    expect(dedupeKeys([DOCS_KEY, docKey("doc_a"), ["docs"], docKey("doc_a"), TREE_KEY])).toEqual([
      ["docs"],
      ["docs", "doc_a"],
      ["tree"],
    ]);
  });

  it("keeps keys that only look alike", () => {
    expect(dedupeKeys([["docs"], ["docs", "doc_a"]])).toHaveLength(2);
  });

  it("returns nothing for nothing", () => {
    expect(dedupeKeys([])).toEqual([]);
  });
});
