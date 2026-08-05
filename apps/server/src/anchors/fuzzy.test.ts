import { describe, expect, it } from "vitest";
import {
  FUZZY_THRESHOLD,
  MAX_FUZZY_EXACT_LENGTH,
  boundedLevenshtein,
  findFuzzyRange,
} from "./fuzzy.js";

const noContext = (exact: string, hint = 0) => ({ exact, prefix: "", suffix: "", hint });

describe("boundedLevenshtein", () => {
  it.each([
    ["", "", 5, 0],
    ["abc", "abc", 5, 0],
    ["abc", "abd", 5, 1],
    ["kitten", "sitting", 10, 3],
    ["abc", "", 5, 3],
    ["", "abc", 5, 3],
    ["flaw", "lawn", 5, 2],
  ])("distance(%j, %j) with budget %i is %i", (a, b, maxDistance, expected) => {
    expect(boundedLevenshtein(a, b, maxDistance)).toBe(expected);
  });

  it("returns maxDistance + 1 when the distance exceeds the budget", () => {
    expect(boundedLevenshtein("kitten", "sitting", 2)).toBe(3);
    expect(boundedLevenshtein("aaaaaaaaaa", "bbbbbbbbbb", 4)).toBe(5);
  });

  it("short-circuits on a length difference beyond the budget", () => {
    expect(boundedLevenshtein("ab", "abcdefgh", 3)).toBe(4);
  });

  it("returns the exact distance at the budget boundary", () => {
    expect(boundedLevenshtein("aaaa", "bbbb", 4)).toBe(4);
    expect(boundedLevenshtein("aaaa", "bbbb", 3)).toBe(4);
  });
});

describe("findFuzzyRange", () => {
  it("resolves a lightly typo'd body and is deterministic across 100 runs", () => {
    const exact = "the model we assume a 30-year fixed at 6.1 percent";
    const body = `Intro paragraph with unrelated words.\nHere the model we assune a 30-yaer fixed at 6.1 percent holds.\nClosing line.`;
    const first = findFuzzyRange(body, noContext(exact));
    expect(first).not.toBeNull();
    const slice = body.slice(first?.start, first?.end);
    expect(slice).toContain("assune a 30-yaer fixed");
    for (let i = 0; i < 100; i++) {
      expect(findFuzzyRange(body, noContext(exact))).toEqual(first);
    }
  });

  it("returns null against an entirely unrelated body", () => {
    const exact = "the model we assume a 30-year fixed at 6.1 percent";
    const body = "Recipe: whisk three eggs, add flour and a pinch of salt, bake until golden.";
    expect(findFuzzyRange(body, noContext(exact))).toBeNull();
  });

  it("accepts a window exactly at the similarity threshold and rejects one just below", () => {
    // 40-unit exact; edits confined to the tail so the bitap seed (head) still
    // fires. Budget = floor(40 × (1 − 0.75)) = 10 substitutions.
    const exact = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";
    expect(exact.length).toBe(40);
    const atThreshold = `${exact.slice(0, 30)}0123456789`;
    const belowThreshold = `${exact.slice(0, 29)}01234567890`;
    const wrap = (window: string) => `some leading prose ${window} some trailing prose`;

    const accepted = findFuzzyRange(wrap(atThreshold), noContext(exact));
    expect(accepted).not.toBeNull();
    expect(wrap(atThreshold).slice(accepted?.start, accepted?.end)).toBe(atThreshold);

    expect(findFuzzyRange(wrap(belowThreshold), noContext(exact))).toBeNull();
  });

  it("breaks ties between identical windows by declared-context agreement", () => {
    const exact = "duplicated sentence body";
    const body = `A ${exact} B. Meanwhile C ${exact} D.`;
    const second = body.lastIndexOf(exact);
    const range = findFuzzyRange(body, {
      exact,
      prefix: "Meanwhile C ",
      suffix: " D.",
      hint: 0,
    });
    expect(range?.start).toBe(second);
  });

  it("breaks remaining ties by proximity to the hint, then earliest offset", () => {
    const exact = "duplicated sentence body";
    const body = `A ${exact} B. Meanwhile C ${exact} D.`;
    const first = body.indexOf(exact);
    const second = body.lastIndexOf(exact);
    expect(findFuzzyRange(body, noContext(exact, second - 1))?.start).toBe(second);
    expect(findFuzzyRange(body, noContext(exact, 0))?.start).toBe(first);
  });

  it("finds a match whose head was edited (bitap seed fails, shingles recover)", () => {
    const exact = "0123456789 the remainder of this anchored sentence stays intact";
    const body = `Lead-in text. XXXXXXXXXX the remainder of this anchored sentence stays intact. Tail.`;
    const range = findFuzzyRange(body, noContext(exact));
    expect(range).not.toBeNull();
    expect(body.slice(range?.start, range?.end)).toContain("remainder of this anchored");
  });

  it("skips fuzzy entirely for a pathologically long exact", () => {
    const exact = "x".repeat(MAX_FUZZY_EXACT_LENGTH + 1);
    expect(findFuzzyRange(exact, noContext(exact))).toBeNull();
  });

  it("returns null for an empty exact or empty body", () => {
    expect(findFuzzyRange("some body", noContext(""))).toBeNull();
    expect(findFuzzyRange("", noContext("needle"))).toBeNull();
  });

  it("refuses a deleted bullet's parallel sibling, which the quote alone would accept", () => {
    // The exact reason rung 3 was kept off the read path before SERVER-055.
    const exact = "- bread from the corner bakery";
    const sibling = "- milk from the corner bakery";
    const body = `Groceries:\n\n${sibling}\n`;
    // Quote similarity alone is comfortably above the threshold: five edits on a
    // 30-unit needle, against a budget of floor(30 × 0.25) = 7.
    expect(boundedLevenshtein(sibling, exact, 7)).toBeLessThanOrEqual(7);
    expect(findFuzzyRange(body, noContext(exact))).not.toBeNull();
    // With the selector's own context, the sibling's neighbours give it away.
    expect(
      findFuzzyRange(body, {
        exact,
        prefix: "Groceries:\n\n",
        suffix: `\n${sibling}`,
        hint: 0,
      }),
    ).toBeNull();
  });

  it("accepts an in-place edit of the quote, whose surroundings are intact", () => {
    const exact = "assume a 30-year fixed at 6.1%";
    const body =
      "The model we use here: let us assume a 30-year fixed at 6.4% for the base case.\n";
    const range = findFuzzyRange(body, {
      exact,
      prefix: "here: let us ",
      suffix: " for the base case.",
      hint: 0,
    });
    expect(body.slice(range?.start, range?.end)).toBe("assume a 30-year fixed at 6.4%");
  });

  it("refuses a candidate whose quote matches but whose context is a different passage", () => {
    // Same sentence twice; only the second carries the declared surroundings,
    // and the second is the one the edit corrupted. The first is a lookalike.
    const exact = "the rate is reviewed every quarter";
    const body = `Appendix A. ${exact}. End of appendix.\n\nPolicy: the rate is reviewd every quarter, per the board.`;
    const range = findFuzzyRange(body, {
      exact,
      prefix: "Policy: ",
      suffix: ", per the board.",
      hint: 0,
    });
    expect(range?.start).toBe(body.indexOf("the rate is reviewd"));
  });

  it("never returns a range splitting a surrogate pair", () => {
    const body = `🎉🎊🎈 anchred sentence with a typo 🚀 and trailing emoji 🌍`;
    const exact = "anchored sentence with a typo";
    const range = findFuzzyRange(body, noContext(exact));
    expect(range).not.toBeNull();
    if (range) {
      const slice = body.slice(range.start, range.end);
      expect(slice.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00);
      expect(1 - boundedLevenshtein(slice, exact, 10) / exact.length >= FUZZY_THRESHOLD).toBe(true);
    }
  });
});
