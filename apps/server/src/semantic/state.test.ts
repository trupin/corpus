import { SEMANTIC_INDEX_STATES } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { createIndexRebuildFlag, semanticIndexState, type SemanticIndexFacts } from "./state.js";

const facts = (overrides: Partial<SemanticIndexFacts> = {}): SemanticIndexFacts => ({
  providerResolved: true,
  usableVectors: 10,
  pending: 0,
  rebuilding: false,
  ...overrides,
});

describe("semanticIndexState", () => {
  it("says `current` when an index is caught up", () => {
    expect(semanticIndexState(facts())).toBe("current");
  });

  it("says `stale` for an incremental backlog", () => {
    expect(semanticIndexState(facts({ pending: 3 }))).toBe("stale");
  });

  it("says `indexing` while a rebuild is in flight, outranking `stale`", () => {
    // sprint-021 Open Conflict 4: a rebuild always implies pending > 0, so both
    // descriptions fit; the rebuild flag is the more specific claim.
    expect(semanticIndexState(facts({ pending: 500, rebuilding: true }))).toBe("indexing");
    expect(semanticIndexState(facts({ pending: 500, rebuilding: false }))).toBe("stale");
  });

  it("says `indexing` even with nothing usable yet — a rebuild discards first", () => {
    expect(semanticIndexState(facts({ usableVectors: 0, pending: 40, rebuilding: true }))).toBe(
      "indexing",
    );
  });

  it("says `disabled` for each of the three ways to have no usable index", () => {
    // No provider resolved…
    expect(semanticIndexState(facts({ providerResolved: false }))).toBe("disabled");
    // …no recorded identity / no vectors at all…
    expect(semanticIndexState(facts({ usableVectors: 0 }))).toBe("disabled");
    // …and vectors that exist but belong to another model, which reach here as
    // zero usable ones because the count is taken at the *resolved* identity.
    expect(semanticIndexState(facts({ usableVectors: 0, pending: 2 }))).toBe("disabled");
  });

  it("never invents a value outside the frozen enum", () => {
    for (const providerResolved of [true, false]) {
      for (const usableVectors of [0, 5]) {
        for (const pending of [0, 7]) {
          for (const rebuilding of [true, false]) {
            expect(SEMANTIC_INDEX_STATES).toContain(
              semanticIndexState({ providerResolved, usableVectors, pending, rebuilding }),
            );
          }
        }
      }
    }
  });
});

describe("createIndexRebuildFlag", () => {
  it("starts down, raises, and lowers", () => {
    const flag = createIndexRebuildFlag();
    expect(flag.active).toBe(false);
    flag.begin();
    expect(flag.active).toBe(true);
    flag.end();
    expect(flag.active).toBe(false);
  });

  it("holds while overlapping rebuilds are in flight", () => {
    const flag = createIndexRebuildFlag();
    flag.begin();
    flag.begin();
    flag.end();
    expect(flag.active).toBe(true);
    flag.end();
    expect(flag.active).toBe(false);
  });

  it("cannot be driven below zero by an unmatched end", () => {
    const flag = createIndexRebuildFlag();
    flag.end();
    flag.end();
    expect(flag.active).toBe(false);
    flag.begin();
    expect(flag.active).toBe(true);
  });
});
