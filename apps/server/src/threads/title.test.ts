import { describe, expect, it } from "vitest";
import {
  ANCHOR_TITLE_QUOTE_LENGTH,
  STANDALONE_TITLE_LENGTH,
  UNTITLED_THREAD,
  deriveThreadTitle,
  firstProseLine,
} from "./title.js";

describe("firstProseLine", () => {
  it("takes the first non-empty line", () => {
    expect(firstProseLine("\n\n  What should I read about X?  \nmore")).toBe(
      "What should I read about X?",
    );
  });

  it("skips fenced code, so a turn opening with a snippet is titled by its prose", () => {
    expect(firstProseLine("```sh\ncorpus doc create\n```\nHow do I do this?")).toBe(
      "How do I do this?",
    );
  });

  it("finds nothing in a body that is only a fence", () => {
    expect(firstProseLine("```\n```")).toBeNull();
    expect(firstProseLine("   \n\t\n")).toBeNull();
  });
});

describe("deriveThreadTitle", () => {
  it("quotes the anchor for an anchored thread", () => {
    expect(
      deriveThreadTitle({ exact: "assume a 30-year fixed at 6.1%", body: "is this right?" }),
    ).toBe('Re: "assume a 30-year fixed at 6.1%"');
  });

  it("truncates the quote at the documented length", () => {
    const exact = "x".repeat(120);
    const title = deriveThreadTitle({ exact, body: "?" });
    expect(ANCHOR_TITLE_QUOTE_LENGTH).toBe(60);
    expect(title).toBe(`Re: "${"x".repeat(ANCHOR_TITLE_QUOTE_LENGTH)}"`);
  });

  it("names the parent for a whole-document thread", () => {
    expect(deriveThreadTitle({ parentTitle: "Mortgage model", body: "general note" })).toBe(
      "Re: Mortgage model",
    );
  });

  it("uses the first turn for a standalone thread, truncated", () => {
    const line = "y".repeat(120);
    expect(deriveThreadTitle({ body: line })).toBe("y".repeat(STANDALONE_TITLE_LENGTH));
    expect(STANDALONE_TITLE_LENGTH).toBe(80);
  });

  it("falls back when the first turn yields no prose", () => {
    expect(deriveThreadTitle({ body: "```\n@agent\n```" })).toBe(UNTITLED_THREAD);
  });

  it("lets an explicit title win in every mode", () => {
    const explicit = { title: "Chosen" };
    expect(deriveThreadTitle({ ...explicit, exact: "quoted", body: "b" })).toBe("Chosen");
    expect(deriveThreadTitle({ ...explicit, parentTitle: "Parent", body: "b" })).toBe("Chosen");
    expect(deriveThreadTitle({ ...explicit, body: "b" })).toBe("Chosen");
  });

  it("ignores a blank explicit title rather than titling a thread with spaces", () => {
    expect(deriveThreadTitle({ title: "   ", parentTitle: "Parent", body: "b" })).toBe(
      "Re: Parent",
    );
  });

  it("ignores a blank parent title", () => {
    expect(deriveThreadTitle({ parentTitle: "  ", body: "first line" })).toBe("first line");
  });
});
