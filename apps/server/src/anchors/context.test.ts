import { describe, expect, it } from "vitest";
import { isWellFormedText } from "./code-points.js";
import { CONTEXT_WINDOW, computeContext } from "./context.js";

describe("computeContext", () => {
  it("takes exactly CONTEXT_WINDOW units on each side mid-body", () => {
    const body = `${"a".repeat(100)}TARGET${"b".repeat(100)}`;
    const { prefix, suffix } = computeContext(body, 100, 106);
    expect(prefix).toBe("a".repeat(CONTEXT_WINDOW));
    expect(suffix).toBe("b".repeat(CONTEXT_WINDOW));
  });

  it("clips at the body start and end", () => {
    const body = "abTARGETcd";
    const { prefix, suffix } = computeContext(body, 2, 8);
    expect(prefix).toBe("ab");
    expect(suffix).toBe("cd");
  });

  it("returns empty context for a range spanning the whole body", () => {
    const body = "TARGET";
    expect(computeContext(body, 0, body.length)).toEqual({ prefix: "", suffix: "" });
  });

  it("is verbatim — no whitespace normalization", () => {
    const body = "x  \n\t yTARGETz \r\n w";
    const { prefix, suffix } = computeContext(body, 7, 13);
    expect(prefix).toBe("x  \n\t y");
    expect(suffix).toBe("z \r\n w");
  });

  it("expands the prefix cut by one unit rather than splitting a surrogate pair", () => {
    // 20 emoji (40 units) then "x": a range starting at 41 puts the cut at 9,
    // between the halves of the fifth emoji.
    const body = `${"🎉".repeat(20)}xTARGET trailing text here`;
    const { prefix } = computeContext(body, 41, 47);
    expect(prefix).toBe(`${"🎉".repeat(16)}x`);
    expect(prefix.length).toBe(CONTEXT_WINDOW + 1);
    expect(isWellFormedText(prefix)).toBe(true);
  });

  it("expands the suffix cut by one unit rather than splitting a surrogate pair", () => {
    // "TARGET" then "x" then 20 emoji: a range ending at 6 puts the cut at 38,
    // between the halves of an emoji.
    const body = `TARGETx${"🎉".repeat(20)}`;
    const { suffix } = computeContext(body, 0, 6);
    expect(suffix).toBe(`x${"🎉".repeat(16)}`);
    expect(suffix.length).toBe(CONTEXT_WINDOW + 1);
    expect(isWellFormedText(suffix)).toBe(true);
  });
});
