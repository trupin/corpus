import { describe, expect, it } from "vitest";
import { ONE_LINE_ELLIPSIS, ONE_LINE_MAX_CHARS, toOneLine } from "./one-line.js";

describe("toOneLine", () => {
  it("collapses every whitespace run, newlines included", () => {
    expect(toOneLine("  first line\n\n  second\tline \r\n")).toBe("first line second line");
  });

  it("leaves a short line untouched", () => {
    expect(toOneLine("already one line")).toBe("already one line");
  });

  it("is empty for whitespace-only text", () => {
    expect(toOneLine("\n\n   \t")).toBe("");
  });

  it("bounds a long line and marks the truncation", () => {
    const line = toOneLine(`${"word ".repeat(200)}tail`);
    expect(line.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS);
    expect(line.endsWith(ONE_LINE_ELLIPSIS)).toBe(true);
    expect(line).not.toContain("tail");
  });

  it("cuts at a word boundary when one is near the bound", () => {
    const line = toOneLine(`${"word ".repeat(200)}`);
    expect(line).toBe(`${"word ".repeat(32).trimEnd()}${ONE_LINE_ELLIPSIS}`);
  });

  it("cuts mid-token rather than losing most of the line to one long token", () => {
    const line = toOneLine(`short ${"x".repeat(400)}`);
    expect(line.startsWith("short x")).toBe(true);
    expect(line.length).toBe(ONE_LINE_MAX_CHARS);
  });

  it("honours an explicit bound", () => {
    expect(toOneLine("abcdefghij", 4)).toBe(`abc${ONE_LINE_ELLIPSIS}`);
  });

  describe("the bound includes the ellipsis", () => {
    const CONTEXT_CAP = 320;

    it("keeps a URL-led line inside a context pack's excerpt cap", () => {
      // The reviewer's repro: no space anywhere near the cut, so the marker used
      // to be appended *after* a full-width slice — 321 characters against a
      // schema that publishes `maxLength: 320`.
      const line = toOneLine(`See https://example.com/${"a".repeat(400)}`, CONTEXT_CAP);
      expect(line.length).toBe(CONTEXT_CAP);
      expect(line.endsWith(ONE_LINE_ELLIPSIS)).toBe(true);
    });

    it("never exceeds the bound, wherever an unbroken token crosses the word-break floor", () => {
      // One long token slid across the 240–320 window: at every offset the last
      // space sits either side of `WORD_BREAK_FLOOR`, exercising both branches.
      for (let prefixWords = 0; prefixWords <= 80; prefixWords += 1) {
        const text = `${"word ".repeat(prefixWords)}${"z".repeat(500)}`;
        for (const maxChars of [4, 40, ONE_LINE_MAX_CHARS, CONTEXT_CAP]) {
          const line = toOneLine(text, maxChars);
          expect(line.length).toBeLessThanOrEqual(maxChars);
          expect(line.endsWith(ONE_LINE_ELLIPSIS)).toBe(true);
        }
      }
    });

    it("never exceeds a bound as small as the marker itself", () => {
      expect(toOneLine("abcdefghij", 1)).toBe(ONE_LINE_ELLIPSIS);
      expect(toOneLine("abcdefghij", 0)).toBe("");
    });
  });
});
