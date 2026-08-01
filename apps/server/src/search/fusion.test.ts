import { RETRIEVAL_DEFAULT_LIMIT, RETRIEVAL_MAX_LIMIT } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_OVERFETCH_CAP,
  RETRIEVAL_OVERFETCH_FACTOR,
  RRF_K,
  fuseRankings,
  overFetchLimit,
} from "./fusion.js";

const idsOf = (entries: readonly { readonly id: string }[]): string[] =>
  entries.map((entry) => entry.id);

describe("fuseRankings", () => {
  it("re-derives a single list exactly — the byte-stability property", () => {
    // TEST-883's mechanism: with no semantic candidates there is one list, and
    // `1 / (k + i)` is strictly decreasing, so fusing it cannot permute it.
    const list = ["d", "c", "b", "a", "e"];
    expect(idsOf(fuseRankings([list], 10))).toEqual(list);
    expect(idsOf(fuseRankings([list, []], 10))).toEqual(list);
  });

  it("promotes a document that is deep on one list and first on the other", () => {
    // TEST-882's arithmetic, spelled out: a document ranked 11th lexically
    // (1/71) and 1st semantically (1/61) totals more than a document ranked 1st
    // lexically and nowhere semantically (1/61).
    const lexical = Array.from({ length: 12 }, (_, index) => `lex${String(index + 1)}`);
    const semantic = ["lex11", "other"];
    const fused = fuseRankings([lexical, semantic], RETRIEVAL_DEFAULT_LIMIT);

    expect(fused[0]?.id).toBe("lex11");
    expect(fused[0]?.score).toBeCloseTo(1 / (RRF_K + 11) + 1 / (RRF_K + 1), 12);
    expect(fused[1]?.id).toBe("lex1");
    expect(fused).toHaveLength(RETRIEVAL_DEFAULT_LIMIT);
  });

  it("breaks a tie by id, never by which list or which row came first", () => {
    // Two documents at the same position on different lists score identically.
    // The rule is the one every shipped ordering ends with — `d.id ASC`.
    const fused = fuseRankings([["zeta"], ["alpha"]], 10);
    expect(idsOf(fused)).toEqual(["alpha", "zeta"]);
    expect(fused[0]?.score).toBe(fused[1]?.score);
    // Swapping the list order cannot change the answer.
    expect(idsOf(fuseRankings([["alpha"], ["zeta"]], 10))).toEqual(["alpha", "zeta"]);
  });

  it("is deterministic for fixed inputs, run after run", () => {
    const lexical = ["a", "b", "c", "d", "e", "f"];
    const semantic = ["f", "a", "z", "y"];
    const once = fuseRankings([lexical, semantic], 5);
    for (let run = 0; run < 5; run += 1) {
      expect(fuseRankings([lexical, semantic], 5)).toEqual(once);
    }
  });

  it("counts a document once however many lists carried it", () => {
    const fused = fuseRankings([["a", "b"], ["a"], ["a"]], 10);
    expect(idsOf(fused)).toEqual(["a", "b"]);
    expect(fused[0]?.score).toBeCloseTo(3 / (RRF_K + 1), 12);
  });

  it("caps at the limit and survives a degenerate one", () => {
    expect(fuseRankings([["a", "b", "c"]], 2)).toHaveLength(2);
    expect(fuseRankings([["a"]], 0)).toEqual([]);
    expect(fuseRankings([], 10)).toEqual([]);
  });
});

describe("overFetchLimit", () => {
  it("fetches a documented multiple of the caller's limit", () => {
    expect(RETRIEVAL_OVERFETCH_FACTOR).toBe(5);
    expect(overFetchLimit(RETRIEVAL_DEFAULT_LIMIT)).toBe(
      RETRIEVAL_DEFAULT_LIMIT * RETRIEVAL_OVERFETCH_FACTOR,
    );
    expect(overFetchLimit(1)).toBe(RETRIEVAL_OVERFETCH_FACTOR);
  });

  it("stays inside the cap at the contract's largest limit", () => {
    expect(overFetchLimit(RETRIEVAL_MAX_LIMIT)).toBe(RETRIEVAL_OVERFETCH_CAP);
    expect(overFetchLimit(RETRIEVAL_MAX_LIMIT)).toBeLessThanOrEqual(RETRIEVAL_OVERFETCH_CAP);
  });

  it("always fetches at least the page it is asked for", () => {
    for (const limit of [1, 3, 10, 25, RETRIEVAL_MAX_LIMIT]) {
      expect(overFetchLimit(limit)).toBeGreaterThanOrEqual(limit);
    }
  });
});
