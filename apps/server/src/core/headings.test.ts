import { describe, expect, it } from "vitest";
import { enclosingHeadings, headingSections } from "./headings.js";

describe("enclosingHeadings", () => {
  const at = (text: string, needle: string): readonly string[] =>
    enclosingHeadings(text, text.indexOf(needle));

  it("names every enclosing level, outermost first", () => {
    const text = "# A\n\n## B\n\n### C\n\nneedle here\n";
    expect(at(text, "needle")).toEqual(["A", "B", "C"]);
  });

  it("replaces a sibling rather than nesting under it", () => {
    const text = "# A\n\n## B\n\ntext\n\n## D\n\nneedle here\n";
    expect(at(text, "needle")).toEqual(["A", "D"]);
  });

  it("reports nothing for a passage with no heading above it", () => {
    expect(at("Opening line with a needle in it.\n\n## Later\n", "needle")).toEqual([]);
  });

  it("addresses the section a heading itself names when the match is on it", () => {
    const text = "# A\n\n## Rates and needles\n\nbody\n";
    expect(at(text, "needle")).toEqual(["A", "Rates and needles"]);
  });

  it("ignores headings inside a fenced code block", () => {
    const text = "## Rates\n\n```md\n# Fake\n## Also fake\n```\n\nThe needle is here.\n";
    expect(at(text, "needle")).toEqual(["Rates"]);
  });

  it("still closes a level for a heading with no text", () => {
    const text = "# A\n\n## B\n\n##\n\nneedle\n";
    expect(at(text, "needle")).toEqual(["A"]);
  });

  it("drops a closing sequence and leading indentation", () => {
    const text = "  ## Rates ##\n\nneedle\n";
    expect(at(text, "needle")).toEqual(["Rates"]);
  });

  it("does not read four-space-indented hashes as a heading", () => {
    const text = "# A\n\n    #### indented\n\nneedle\n";
    expect(at(text, "needle")).toEqual(["A"]);
  });

  it("does not read a setext underline as a heading", () => {
    const text = "Title\n=====\n\nneedle\n";
    expect(at(text, "needle")).toEqual([]);
  });

  it("ignores a heading below the passage", () => {
    const text = "# A\n\nneedle\n\n## Below\n";
    expect(at(text, "needle")).toEqual(["A"]);
  });

  it("answers for an offset past the end with the last section", () => {
    const text = "# A\n\nbody\n";
    expect(enclosingHeadings(text, text.length)).toEqual(["A"]);
  });

  it("answers nothing for an empty body", () => {
    expect(enclosingHeadings("", 0)).toEqual([]);
  });
});

describe("headingSections", () => {
  it("partitions the body: contiguous, covering, in order", () => {
    const text = "intro\n\n# A\n\nunder a\n\n## B\n\nunder b\n";
    const sections = headingSections(text);
    expect(sections.map((section) => section.headings)).toEqual([[], ["A"], ["A", "B"]]);
    expect(sections[0]?.start).toBe(0);
    expect(sections.at(-1)?.end).toBe(text.length);
    for (let index = 1; index < sections.length; index += 1) {
      expect(sections[index]?.start).toBe(sections[index - 1]?.end);
    }
    expect(sections.map((section) => text.slice(section.start, section.end)).join("")).toBe(text);
  });

  it("keeps an empty leading section when the body opens on a heading", () => {
    const sections = headingSections("# A\n\nbody\n");
    expect(sections[0]).toEqual({ headings: [], start: 0, end: 0 });
  });

  it("gives an empty body exactly one empty section", () => {
    expect(headingSections("")).toEqual([{ headings: [], start: 0, end: 0 }]);
  });

  it("keeps a fenced heading inside the section that encloses the fence", () => {
    const text = "## Real\n\n```\n## Fake\n```\n\ntail\n";
    const sections = headingSections(text);
    expect(sections.map((section) => section.headings)).toEqual([[], ["Real"]]);
    expect(text.slice(sections[1]?.start, sections[1]?.end)).toContain("## Fake");
  });
});
