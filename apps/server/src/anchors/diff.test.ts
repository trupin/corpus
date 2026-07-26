import { describe, expect, it } from "vitest";
import { computeOffsetMapper } from "./diff.js";

const rangeOf = (body: string, needle: string): { start: number; end: number } => {
  const start = body.indexOf(needle);
  if (start === -1) throw new Error(`fixture bug: ${JSON.stringify(needle)} not in body`);
  return { start, end: start + needle.length };
};

describe("computeOffsetMapper — mapping", () => {
  it("maps a range across an insertion before it", () => {
    const oldBody = "one two three";
    const newBody = "one inserted words two three";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start, end } = rangeOf(oldBody, "two");
    expect(newBody.slice(mapper.mapStart(start), mapper.mapEnd(end))).toBe("two");
  });

  it("keeps a range fixed across an insertion after it", () => {
    const oldBody = "one two three";
    const newBody = "one two three and more";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start, end } = rangeOf(oldBody, "two");
    expect(mapper.mapStart(start)).toBe(start);
    expect(mapper.mapEnd(end)).toBe(end);
  });

  it("excludes an insertion sitting exactly at the range start", () => {
    const oldBody = "one two three";
    const newBody = "one extra two three";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start, end } = rangeOf(oldBody, "two");
    expect(newBody.slice(mapper.mapStart(start), mapper.mapEnd(end))).toBe("two");
  });

  it("excludes an insertion sitting exactly at the range end", () => {
    const oldBody = "one two three";
    const newBody = "one two extra three";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start, end } = rangeOf(oldBody, "two");
    expect(newBody.slice(mapper.mapStart(start), mapper.mapEnd(end))).toBe("two");
    expect(mapper.classify({ start, end })).toBe("equal");
  });

  it("includes replacement text when a deletion ends inside the range tail", () => {
    const oldBody = "the quick brown fox";
    const newBody = "the quick blist fox";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start, end } = rangeOf(oldBody, "quick brown");
    expect(newBody.slice(mapper.mapStart(start), mapper.mapEnd(end))).toBe("quick blist");
  });

  it("collapses offsets inside a deleted run to the deletion's start", () => {
    const oldBody = "keep DELETED keep";
    const newBody = "keep keep";
    const mapper = computeOffsetMapper(oldBody, newBody);
    const { start } = rangeOf(oldBody, "DELETED");
    expect(mapper.mapStart(start + 3)).toBe(5);
  });

  it("maps the body-end offset to the new body end", () => {
    const oldBody = "abc";
    const newBody = "abc def";
    const mapper = computeOffsetMapper(oldBody, newBody);
    expect(mapper.mapEnd(3)).toBe(3);
    expect(mapper.mapStart(3)).toBe(newBody.length);
  });

  it("handles an emptied body without throwing", () => {
    const mapper = computeOffsetMapper("some old text", "");
    expect(mapper.mapStart(5)).toBe(0);
    expect(mapper.mapEnd(9)).toBe(0);
    expect(mapper.classify({ start: 0, end: 13 })).toBe("deleted");
  });

  it("handles an empty old body without throwing", () => {
    const mapper = computeOffsetMapper("", "brand new text");
    expect(mapper.mapStart(0)).toBe("brand new text".length);
    expect(mapper.mapEnd(0)).toBe(0);
    expect(mapper.classify({ start: 0, end: 0 })).toBe("deleted");
  });
});

describe("computeOffsetMapper — classify", () => {
  const oldBody = "First sentence here.\n\nThe anchored sentence sits here.\n\nLast sentence.";

  it("classifies an untouched range as equal when edits fall elsewhere", () => {
    const newBody = oldBody.replace("Last sentence.", "A different closing line.");
    const mapper = computeOffsetMapper(oldBody, newBody);
    expect(mapper.classify(rangeOf(oldBody, "The anchored sentence sits here."))).toBe("equal");
  });

  it("classifies an interior replacement as partial", () => {
    const newBody = oldBody.replace("sits here", "now lives elsewhere");
    const mapper = computeOffsetMapper(oldBody, newBody);
    expect(mapper.classify(rangeOf(oldBody, "The anchored sentence sits here."))).toBe("partial");
  });

  it("classifies an insertion strictly inside the range as partial", () => {
    const newBody = oldBody.replace("anchored sentence", "anchored (edited) sentence");
    const mapper = computeOffsetMapper(oldBody, newBody);
    expect(mapper.classify(rangeOf(oldBody, "The anchored sentence sits here."))).toBe("partial");
  });

  it("classifies a fully deleted range as deleted", () => {
    const newBody = oldBody.replace("\n\nThe anchored sentence sits here.", "");
    const mapper = computeOffsetMapper(oldBody, newBody);
    expect(mapper.classify(rangeOf(oldBody, "The anchored sentence sits here."))).toBe("deleted");
  });

  it("classifies a whole-body rewrite as deleted", () => {
    const mapper = computeOffsetMapper(oldBody, "Entirely unrelated replacement prose.");
    expect(mapper.classify(rangeOf(oldBody, "The anchored sentence sits here."))).toBe("deleted");
  });

  it("treats an empty range as deleted", () => {
    const mapper = computeOffsetMapper(oldBody, oldBody);
    expect(mapper.classify({ start: 3, end: 3 })).toBe("deleted");
  });

  it("survives a CRLF → LF conversion as a remap, not a wipe", () => {
    const oldCrlf = "line one\r\nline two\r\nline three\r\nline four\r\n";
    const newLf = oldCrlf.replaceAll("\r\n", "\n");
    const mapper = computeOffsetMapper(oldCrlf, newLf);
    const { start, end } = rangeOf(oldCrlf, "line two");
    expect(mapper.classify({ start, end })).not.toBe("deleted");
    expect(newLf.slice(mapper.mapStart(start), mapper.mapEnd(end))).toBe("line two");
  });
});
