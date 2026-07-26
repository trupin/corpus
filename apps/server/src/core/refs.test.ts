import { describe, expect, it } from "vitest";
import { extractRefs, referencedIds } from "./refs.js";

describe("extractRefs", () => {
  it("returns refs in source order with ids, aliases and slicing offsets", () => {
    const body = "See [[doc_a1b2c3]] and [[th_x9y8|as text]].";
    const refs = extractRefs(body);
    expect(refs).toEqual([
      { id: "doc_a1b2c3", alias: null, start: 4, end: 18 },
      { id: "th_x9y8", alias: "as text", start: 23, end: 42 },
    ]);
    expect(body.slice(refs[0]?.start, refs[0]?.end)).toBe("[[doc_a1b2c3]]");
    expect(body.slice(refs[1]?.start, refs[1]?.end)).toBe("[[th_x9y8|as text]]");
  });

  it("handles two adjacent refs", () => {
    expect(extractRefs("[[doc_aaaa]][[doc_bbbb]]").map((ref) => ref.id)).toEqual([
      "doc_aaaa",
      "doc_bbbb",
    ]);
  });

  it("ignores refs inside a fenced code block", () => {
    const body = "Real [[doc_real01]]\n```md\n[[doc_ignored]]\n```\n";
    expect(extractRefs(body).map((ref) => ref.id)).toEqual(["doc_real01"]);
  });

  it("ignores refs inside an inline code span", () => {
    const body = "Write `[[doc_alsoignored]]` to link [[doc_real01]].";
    expect(extractRefs(body).map((ref) => ref.id)).toEqual(["doc_real01"]);
  });

  it("returns nothing and does not throw for malformed brackets", () => {
    expect(extractRefs("[[unclosed and [[ and ]] and [[]]")).toEqual([]);
  });

  it("ignores bracketed text that is not a document id", () => {
    expect(extractRefs("[[not an id]] [[evt_7c1d]] [[anc_k4f7]]")).toEqual([]);
  });

  it("accepts an empty alias", () => {
    expect(extractRefs("[[doc_a1b2c3|]]")[0]?.alias).toBe("");
  });

  it("does not let an alias span a line break", () => {
    expect(extractRefs("[[doc_a1b2c3|two\nlines]]")).toEqual([]);
  });

  it("reports offsets in UTF-16 code units past astral-plane characters", () => {
    const body = "🎉 [[doc_a1b2c3]]";
    const ref = extractRefs(body)[0];
    expect(ref?.start).toBe(3);
    expect(body.slice(ref?.start, ref?.end)).toBe("[[doc_a1b2c3]]");
  });

  it("finds nothing in a body with no refs", () => {
    expect(extractRefs("Plain prose.")).toEqual([]);
  });
});

describe("referencedIds", () => {
  it("deduplicates, preserving first-occurrence order", () => {
    expect(referencedIds("[[th_x9y8]] [[doc_a1b2c3]] [[th_x9y8|again]]")).toEqual([
      "th_x9y8",
      "doc_a1b2c3",
    ]);
  });
});
