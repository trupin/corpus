import { describe, expect, it } from "vitest";
import { SNIPPET_CLOSE, SNIPPET_OPEN } from "../docs/index.js";
import { hasMatch, unmarkSnippet } from "./snippet.js";

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
  });

  it("records every marked term", () => {
    const { text, matchOffsets } = unmarkSnippet(`${marked("a")} then ${marked("b")}`);
    expect(text).toBe("a then b");
    expect(matchOffsets).toEqual([0, 7]);
  });

  it("reports a match for a column FTS5 did delimit", () => {
    expect(hasMatch(unmarkSnippet(`head ${marked("rate")} tail`))).toBe(true);
  });
});
