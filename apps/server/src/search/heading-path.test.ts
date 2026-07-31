import { describe, expect, it } from "vitest";
import { SNIPPET_CLOSE, SNIPPET_ELLIPSIS, SNIPPET_OPEN } from "../docs/index.js";
import {
  enclosingHeadings,
  hasMatch,
  locatePassage,
  primaryMatch,
  unmarkSnippet,
} from "./heading-path.js";

const marked = (text: string): string => `${SNIPPET_OPEN}${text}${SNIPPET_CLOSE}`;

describe("unmarkSnippet", () => {
  it("strips the delimiters and reports where the first match landed", () => {
    expect(unmarkSnippet(`the ${marked("rate")} moved`)).toEqual({
      text: "the rate moved",
      matchOffsets: [4],
    });
  });

  it("reports no match for a column that did not match", () => {
    const snippet = unmarkSnippet("nothing highlighted here");
    expect(snippet).toEqual({ text: "nothing highlighted here", matchOffsets: [] });
    expect(hasMatch(snippet)).toBe(false);
    expect(primaryMatch(snippet)).toBeNull();
  });

  it("records every marked term", () => {
    const { text, matchOffsets } = unmarkSnippet(`${marked("a")} then ${marked("b")}`);
    expect(text).toBe("a then b");
    expect(matchOffsets).toEqual([0, 7]);
  });
});

describe("primaryMatch", () => {
  it("is the only match when there is one", () => {
    expect(primaryMatch(unmarkSnippet(`head ${marked("rate")} tail`))).toBe(5);
  });

  it("addresses the cluster the terms converge in, not a stray in the padding", () => {
    // `snippet()` pads the region it scored with context, and the padding can
    // carry an occurrence of its own — from the section above, addressing which
    // would be wrong.
    const snippet = unmarkSnippet(
      `${marked("rate")} of pay. ## Rates The ${marked("rate")} the ${marked("rate")} again`,
    );
    expect(primaryMatch(snippet)).toBe(snippet.text.indexOf("rate", 1));
  });

  it("breaks a tie towards the earlier match", () => {
    const snippet = unmarkSnippet(`${marked("ab")} mid ${marked("cd")}`);
    expect(snippet.matchOffsets).toEqual([0, 7]);
    expect(primaryMatch(snippet)).toBe(0);
  });
});

describe("locatePassage", () => {
  const body = "Intro paragraph.\n\n## Rates\n\nThe escrow rate moved sharply.\n";

  it("finds the matched term through the window FTS5 returned", () => {
    const snippet = unmarkSnippet(`The ${marked("escrow")} rate moved sharply.`);
    expect(locatePassage(body, snippet)).toBe(body.indexOf("escrow"));
  });

  it("finds it through a window FTS5 elided at both ends", () => {
    const snippet = unmarkSnippet(
      `${SNIPPET_ELLIPSIS}The ${marked("escrow")} rate${SNIPPET_ELLIPSIS}`,
    );
    expect(locatePassage(body, snippet)).toBe(body.indexOf("escrow"));
  });

  it("falls back to the term alone when the window does not round-trip", () => {
    const snippet = unmarkSnippet(`rewritten window ${marked("escrow")} elsewhere`);
    expect(locatePassage(body, snippet)).toBe(body.indexOf("escrow"));
  });

  it("matches the term case-insensitively, as the tokenizer does", () => {
    const snippet = unmarkSnippet(`nowhere ${marked("ESCROW")} nowhere`);
    expect(locatePassage(body, snippet)).toBe(body.indexOf("escrow"));
  });

  it("addresses the document itself when nothing matched", () => {
    expect(locatePassage(body, unmarkSnippet("Intro paragraph."))).toBe(0);
  });

  it("addresses the match, not the window, when the window spans a heading", () => {
    // The snippet begins in the previous section and runs past `## Rates` into
    // the match: addressing the window's start would name the section above.
    const snippet = unmarkSnippet(`paragraph. ## Rates The ${marked("escrow")} rate`);
    expect(locatePassage(body, snippet)).toBeGreaterThan(body.indexOf("## Rates"));
  });
});

describe("enclosingHeadings", () => {
  const at = (text: string, needle: string): string[] =>
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
    // Deliberate: the product writes ATX everywhere, and a scanner that guessed
    // at underlines would have to rule on table rules and horizontal lines.
    const text = "Title\n=====\n\nneedle\n";
    expect(at(text, "needle")).toEqual([]);
  });

  it("ignores a heading below the passage", () => {
    const text = "# A\n\nneedle\n\n## Below\n";
    expect(at(text, "needle")).toEqual(["A"]);
  });
});
