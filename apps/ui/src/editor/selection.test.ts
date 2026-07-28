import { describe, expect, it } from "vitest";
import {
  SELECTOR_CONTEXT,
  buildSelection,
  countOccurrences,
  locateSelection,
  nthIndexOf,
  selectorAt,
} from "./selection.js";

/**
 * The 💬 Comment payload — the shape UI-007 consumes, and the arithmetic that
 * turns an editor selection into SPEC.md §6's text-quote selector.
 */

describe("occurrence arithmetic", () => {
  it("counts non-overlapping occurrences", () => {
    expect(countOccurrences("a b a b a", "a")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("abc", "z")).toBe(0);
    expect(countOccurrences("abc", "")).toBe(0);
  });

  it("finds the nth occurrence", () => {
    expect(nthIndexOf("a b a b a", "a", 0)).toBe(0);
    expect(nthIndexOf("a b a b a", "a", 1)).toBe(4);
    expect(nthIndexOf("a b a b a", "a", 2)).toBe(8);
    expect(nthIndexOf("a b a b a", "a", 3)).toBe(-1);
    expect(nthIndexOf("abc", "", 0)).toBe(-1);
    expect(nthIndexOf("abc", "a", -1)).toBe(-1);
  });
});

describe("locating a selection in the body", () => {
  const body = "The rate is 6.4%.\n\nThe rate moved.\n";

  it("finds the first occurrence when nothing precedes it", () => {
    expect(locateSelection(body, "", "The rate")).toEqual({ start: 0, end: 8 });
  });

  it("picks the occurrence the preceding text implies", () => {
    // The editor's plain text before the selection already contained one "The
    // rate", so the selection is the second one.
    expect(locateSelection(body, "The rate is 6.4%.\n", "The rate")).toEqual({
      start: 19,
      end: 27,
    });
  });

  it("falls back to the first occurrence rather than to nothing", () => {
    expect(locateSelection(body, "The rate The rate The rate ", "The rate")).toEqual({
      start: 0,
      end: 8,
    });
  });

  it("answers null when the text is not in the body at all", () => {
    expect(locateSelection(body, "", "nowhere")).toBeNull();
    expect(locateSelection(body, "", "")).toBeNull();
  });
});

describe("the text-quote selector", () => {
  it("carries context on both sides", () => {
    const body = "0123456789".repeat(10);
    const selector = selectorAt(body, { start: 50, end: 55 });
    expect(selector.exact).toBe("01234");
    expect(selector.prefix).toHaveLength(SELECTOR_CONTEXT);
    expect(selector.suffix).toHaveLength(SELECTOR_CONTEXT);
    expect(`${selector.prefix}${selector.exact}${selector.suffix}`).toBe(body.slice(18, 87));
  });

  it("truncates context at the edges of the body", () => {
    const selector = selectorAt("abcdef", { start: 0, end: 3 });
    expect(selector).toEqual({ exact: "abc", prefix: "", suffix: "def" });
  });
});

describe("the payload", () => {
  const body = "# Title\n\nThe rate is 6.4% this week.\n";

  it("carries the positions, the text, the body and the selector", () => {
    const selection = buildSelection({
      docId: "doc_a1b2c3",
      from: 12,
      to: 20,
      text: "The rate",
      textBefore: "Title\n",
      body,
    });
    expect(selection).toEqual({
      docId: "doc_a1b2c3",
      from: 12,
      to: 20,
      text: "The rate",
      body,
      range: { start: 9, end: 17 },
      selector: { exact: "The rate", prefix: "# Title\n\n", suffix: " is 6.4% this week.\n" },
    });
  });

  it("reports a null range rather than guessing", () => {
    // A selection spanning markup the body spells differently: the editor
    // reads `bold text`, the file says `**bold** text`.
    const selection = buildSelection({
      docId: "doc_a1b2c3",
      from: 1,
      to: 10,
      text: "bold text",
      textBefore: "",
      body: "**bold** text\n",
    });
    expect(selection.range).toBeNull();
    expect(selection.selector).toBeNull();
    // The body is still handed over, so a caller with a real offset map can do
    // better than this one could.
    expect(selection.body).toBe("**bold** text\n");
  });
});
