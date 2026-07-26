import { describe, expect, it } from "vitest";
import { isWellFormedText, snapRange, splitsSurrogatePair } from "./code-points.js";

// "🎉" is U+1F389: one astral code point, two UTF-16 code units.
const PARTY = "🎉";

describe("splitsSurrogatePair", () => {
  it("detects an offset between the halves of a surrogate pair", () => {
    const text = `a${PARTY}b`;
    expect(splitsSurrogatePair(text, 2)).toBe(true);
  });

  it("is false on code-point boundaries", () => {
    const text = `a${PARTY}b`;
    for (const offset of [0, 1, 3, 4]) {
      expect(splitsSurrogatePair(text, offset)).toBe(false);
    }
  });

  it("is false outside the string", () => {
    expect(splitsSurrogatePair("ab", -1)).toBe(false);
    expect(splitsSurrogatePair("ab", 5)).toBe(false);
  });

  it("is false for adjacent lone surrogates in the wrong order", () => {
    const text = "\udc00\ud800";
    expect(splitsSurrogatePair(text, 1)).toBe(false);
  });
});

describe("snapRange", () => {
  it("expands a range outward so both ends land on code-point boundaries", () => {
    const text = `${PARTY}${PARTY}${PARTY}`;
    expect(snapRange(text, { start: 1, end: 5 })).toEqual({ start: 0, end: 6 });
  });

  it("leaves an aligned range untouched", () => {
    const text = `a${PARTY}b`;
    expect(snapRange(text, { start: 1, end: 3 })).toEqual({ start: 1, end: 3 });
  });
});

describe("isWellFormedText", () => {
  it("accepts BMP text, pairs, combining marks, and RTL text", () => {
    for (const text of ["", "plain", `x${PARTY}y`, "café", "שלום"]) {
      expect(isWellFormedText(text)).toBe(true);
    }
  });

  it("rejects lone surrogates", () => {
    expect(isWellFormedText("\ud800")).toBe(false);
    expect(isWellFormedText("a\udc00b")).toBe(false);
    expect(isWellFormedText(`${PARTY}`.slice(0, 1))).toBe(false);
  });
});
