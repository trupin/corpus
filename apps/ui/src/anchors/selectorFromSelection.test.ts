import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import { SELECTOR_CONTEXT } from "../editor/selection.js";
import { mdRangeToPm } from "./offsetMap.js";
import { isCommentable, selectorFromSelection } from "./selectorFromSelection.js";
import type { DocumentTrace } from "./traceCache.js";

/**
 * What a comment quotes. Every case here is a property of the *file*, not of
 * the screen — which is the point of computing it from the markdown.
 */

function traced(markdown: string): DocumentTrace {
  const { markdown: canonical, trace } = serializeDoc(parseMarkdown(markdown), { trace: true });
  return { markdown: canonical, trace };
}

/** The PM range that shows `quote`, so a test can select the way a user does. */
function select(source: DocumentTrace, quote: string): { from: number; to: number } {
  const start = source.markdown.indexOf(quote);
  const segments = mdRangeToPm(source.trace, { start, end: start + quote.length });
  const first = segments[0];
  const last = segments.at(-1);
  return { from: first?.from ?? 0, to: last?.to ?? 0 };
}

const BODY =
  "The rate assumption comes from the broker, who quoted 6.1% on Tuesday and " +
  "will not confirm it in writing until Friday afternoon at the earliest.\n";

describe("the selector", () => {
  const source = traced(BODY);

  it("quotes the markdown exactly, with 32 characters of context each side", () => {
    const anchor = selectorFromSelection(source, select(source, "6.1%"));
    expect(anchor?.selector.exact).toBe("6.1%");
    expect(anchor?.selector.prefix).toHaveLength(SELECTOR_CONTEXT);
    expect(anchor?.selector.suffix).toHaveLength(SELECTOR_CONTEXT);
    const at = source.markdown.indexOf("6.1%");
    expect(anchor?.selector.prefix).toBe(source.markdown.slice(at - SELECTOR_CONTEXT, at));
    expect(anchor?.selector.suffix).toBe(source.markdown.slice(at + 4, at + 4 + SELECTOR_CONTEXT));
    expect(anchor?.range).toEqual({ start: at, end: at + 4 });
  });

  it("clamps the prefix at the start of the document", () => {
    const anchor = selectorFromSelection(source, select(source, "The rate"));
    expect(anchor?.selector.prefix).toBe("");
    expect(anchor?.selector.exact).toBe("The rate");
  });

  it("clamps the suffix at the end of the document", () => {
    const anchor = selectorFromSelection(source, select(source, "earliest."));
    // The body's single trailing newline is all that is left after the quote.
    expect(anchor?.selector.suffix.length).toBeLessThan(SELECTOR_CONTEXT);
    expect(anchor?.selector.suffix.trim()).toBe("");
  });

  it("does not trim or normalise anything", () => {
    const spaced = traced("a   b\n\nsecond\n");
    const anchor = selectorFromSelection(spaced, select(spaced, "a   b"));
    expect(anchor?.selector.exact).toBe("a   b");
  });

  it("quotes the markup a selection crosses, not what the screen shows", () => {
    const emphasised = traced("The **30-year fixed** quote is 6.4%.\n");
    const anchor = selectorFromSelection(
      emphasised,
      select(emphasised, "The **30-year fixed** quote"),
    );
    expect(anchor?.selector.exact).toBe("The **30-year fixed** quote");
  });

  it("quotes across a block boundary, newlines and all", () => {
    const two = traced("First paragraph here.\n\nSecond paragraph here.\n");
    const anchor = selectorFromSelection(two, { from: 15, to: 30 });
    expect(anchor?.selector.exact).toContain("\n\n");
  });

  it("quotes a whole [[ref]] when the selection is inside one", () => {
    const refs = traced("See [[doc_a1b2c3]] for the rate.\n");
    const anchor = selectorFromSelection(refs, select(refs, "[[doc_a1b2c3]]"));
    expect(anchor?.selector.exact).toBe("[[doc_a1b2c3]]");
  });
});

describe("a selection that cannot anchor", () => {
  const source = traced(BODY);

  it("is refused when it is empty", () => {
    expect(selectorFromSelection(source, { from: 4, to: 4 })).toBeNull();
  });

  it("is refused when it is whitespace only", () => {
    const spaced = traced("word     word\n");
    const gap = spaced.markdown.indexOf("     ");
    const segments = mdRangeToPm(spaced.trace, { start: gap, end: gap + 5 });
    const first = segments[0];
    expect(
      selectorFromSelection(spaced, { from: first?.from ?? 0, to: first?.to ?? 0 }),
    ).toBeNull();
  });

  it("is refused when it quotes no content at all", () => {
    expect(selectorFromSelection(source, { from: 10_000, to: 10_020 })).toBeNull();
  });

  it("is what the toolbar's disabled state is computed from", () => {
    expect(isCommentable("  \n ")).toBe(false);
    expect(isCommentable("")).toBe(false);
    expect(isCommentable(" a ")).toBe(true);
  });
});
