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
    expect(line.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS + ONE_LINE_ELLIPSIS.length);
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
    expect(line.length).toBe(ONE_LINE_MAX_CHARS + ONE_LINE_ELLIPSIS.length);
  });

  it("honours an explicit bound", () => {
    expect(toOneLine("abcdefghij", 4)).toBe(`abcd${ONE_LINE_ELLIPSIS}`);
  });
});
