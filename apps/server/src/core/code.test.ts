import { describe, expect, it } from "vitest";
import {
  codeRanges,
  fencedCodeRanges,
  inlineCodeRanges,
  overlapsRange,
  splitLines,
} from "./code.js";

const slices = (text: string, ranges: readonly { start: number; end: number }[]): string[] =>
  ranges.map((range) => text.slice(range.start, range.end));

describe("splitLines", () => {
  it("reports content and terminator offsets for LF text", () => {
    expect(splitLines("a\nb")).toEqual([
      { text: "a", start: 0, contentEnd: 1, end: 2 },
      { text: "b", start: 2, contentEnd: 3, end: 3 },
    ]);
  });

  it("strips the carriage return from CRLF lines", () => {
    expect(splitLines("a\r\nb").map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("emits a trailing empty line when the text ends with a newline", () => {
    expect(splitLines("a\n").map((line) => line.text)).toEqual(["a", ""]);
  });

  it("handles a leading newline", () => {
    expect(splitLines("\na").map((line) => line.text)).toEqual(["", "a"]);
  });
});

describe("fencedCodeRanges", () => {
  it("covers a backtick fence, fence lines included", () => {
    const text = "before\n```ts\ncode\n```\nafter\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```ts\ncode\n```"]);
  });

  it("covers a tilde fence", () => {
    const text = "~~~\ncode\n~~~\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["~~~\ncode\n~~~"]);
  });

  it("does not close a backtick fence with a tilde fence", () => {
    const text = "```\ncode\n~~~\nstill code\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n~~~\nstill code\n```"]);
  });

  it("requires the closing fence to be at least as long as the opening one", () => {
    const text = "````\n```\nstill code\n````\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["````\n```\nstill code\n````"]);
  });

  it("runs an unterminated fence to the end of the text", () => {
    const text = "```\ncode\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n"]);
  });

  it("allows up to three spaces of indentation before a fence", () => {
    const text = "   ```\ncode\n   ```\n";
    expect(fencedCodeRanges(text)).toHaveLength(1);
  });

  it("ignores a backtick fence whose info string contains a backtick", () => {
    expect(fencedCodeRanges("```a`b\ntext\n")).toEqual([]);
  });

  it("does not close a fence on a line carrying an info string", () => {
    const text = "```\ncode\n``` trailing\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n``` trailing\n```"]);
  });

  it("finds nothing in plain prose", () => {
    expect(fencedCodeRanges("just prose\nover two lines\n")).toEqual([]);
  });
});

describe("inlineCodeRanges", () => {
  it("covers a span including its delimiters", () => {
    const text = "a `code` b";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`code`"]);
  });

  it("matches runs of equal length only", () => {
    const text = "``a ` b`` c";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["``a ` b``"]);
  });

  it("leaves an unmatched run as literal text", () => {
    expect(inlineCodeRanges("a `unclosed span")).toEqual([]);
  });

  it("finds a later span after an unmatched run", () => {
    const text = "``unmatched then `code` here";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`code`"]);
  });

  it("ignores backticks inside a skipped range", () => {
    const text = "```\n`x`\n```\nthen `y`";
    expect(slices(text, inlineCodeRanges(text, fencedCodeRanges(text)))).toEqual(["`y`"]);
  });

  it("spans a line break", () => {
    const text = "a `two\nlines` b";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`two\nlines`"]);
  });
});

describe("codeRanges", () => {
  it("returns fenced blocks and inline spans together", () => {
    const text = "`one`\n```\ntwo\n```\n`three`";
    expect(slices(text, codeRanges(text)).sort()).toEqual(["```\ntwo\n```", "`one`", "`three`"]);
  });
});

describe("overlapsRange", () => {
  const ranges = [{ start: 5, end: 10 }];

  it.each([
    [0, 5, false],
    [0, 6, true],
    [5, 10, true],
    [9, 12, true],
    [10, 12, false],
  ])("reports [%i,%i) as %s", (start, end, expected) => {
    expect(overlapsRange(ranges, start, end)).toBe(expected);
  });
});
