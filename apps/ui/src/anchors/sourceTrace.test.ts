import { beforeEach, describe, expect, it } from "vitest";
import {
  mdRangeOfProjection,
  projectionRangeOfMd,
  resetSourceTraceCache,
  SOURCE_TRACE_ENTRIES,
  sourceTraceOf,
} from "./sourceTrace";

beforeEach(() => {
  resetSourceTraceCache();
});

/** The markdown a plain range quotes, which is what a selector's `exact` is. */
function quoteOf(markdown: string, plainStart: number, plainEnd: number): string | null {
  const range = mdRangeOfProjection(sourceTraceOf(markdown).runs, "plain", plainStart, plainEnd);
  return range === null ? null : markdown.slice(range.start, range.end);
}

/** Where a phrase sits in the plain projection. */
function plainAt(markdown: string, phrase: string, nth = 0): { start: number; end: number } {
  const { plain } = sourceTraceOf(markdown);
  let cursor = 0;
  for (let seen = 0; ; seen += 1) {
    const at = plain.indexOf(phrase, cursor);
    if (at === -1) throw new Error(`no occurrence ${String(nth)} of "${phrase}" in "${plain}"`);
    if (seen === nth) return { start: at, end: at + phrase.length };
    cursor = at + phrase.length;
  }
}

describe("the plain projection", () => {
  it("drops every piece of syntax the printer wrote, and keeps the join it draws", () => {
    const { plain } = sourceTraceOf("## Rates\n\nWe assume **6.1%** today.\n");
    expect(plain).toBe("Rates\nWe assume 6.1% today.");
  });

  it("keeps a list's items, its bullets' places and not the bullets", () => {
    // `mdast-util-to-hast` wraps a list loosely: one newline before the first
    // item, one between, one after. This is that, and not an invention here.
    expect(sourceTraceOf("- one\n- two\n").plain).toBe("\none\ntwo\n");
  });

  it("keeps a link's text and drops its destination", () => {
    expect(sourceTraceOf("See [the model](http://x/rate) now.").plain).toBe("See the model now.");
  });

  it("keeps a code span's value and drops its backticks", () => {
    expect(sourceTraceOf("Run `npm test` first.").plain).toBe("Run npm test first.");
  });

  it("keeps a fence's code, its trailing newline, and not its fence lines", () => {
    expect(sourceTraceOf("```ts\nconst a = 1;\n```\n").plain).toBe("const a = 1;\n");
  });

  it("drops an image, which renders as an attribute rather than as text", () => {
    expect(sourceTraceOf("Look: ![a chart](attachments/th/t/c.png)").plain).toBe("Look: ");
  });

  it("drops a `[[ref]]`, which renders as a title the file does not contain", () => {
    expect(sourceTraceOf("See [[doc_a1b2c3]] later.").plain).toBe("See  later.");
  });

  it("keeps a `[[not an id]]` token, which renders as the literal text written", () => {
    expect(sourceTraceOf("See [[TODO]] later.").plain).toBe("See [[TODO]] later.");
  });

  it("drops SPEC §5's inline markers, which render as styling rather than as text", () => {
    expect(sourceTraceOf('The [rate]{color="accent"} rose.').plain).toBe("The rate rose.");
    expect(sourceTraceOf("The ==rate== rose.").plain).toBe("The rate rose.");
  });

  it("keeps a table's cells and none of the whitespace between its rows", () => {
    // The one place the trace stops short of the hast: `hast-util-to-jsx-runtime`
    // drops inter-element whitespace inside a table, because `react-dom` warns
    // about any of it, so the reader never sees those newlines.
    const markdown = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(sourceTraceOf(markdown).plain).toBe("ab12");
  });

  it("keeps the newline a markdown hard break draws, which no character spells", () => {
    expect(sourceTraceOf("line one  \nline two").plain).toBe("line one\nline two");
    expect(sourceTraceOf("line one\\\nline two").plain).toBe("line one\nline two");
  });

  it("keeps a typed newline, which is the same in both projections", () => {
    expect(sourceTraceOf("line one\nline two").plain).toBe("line one\nline two");
  });
});

/**
 * The other axis: the same characters with the renderer's own whitespace gone.
 *
 * It exists for `rebase.ts`, which compares two spellings of one document. A
 * blank line moved between them changes where the renderer writes a join, and
 * comparing the rendered projections would report a divergence the documents do
 * not have.
 */
describe("the sourced projection", () => {
  it("is the plain projection minus every join the renderer wrote", () => {
    expect(sourceTraceOf("- one\n- two\n").sourced).toBe("onetwo");
    expect(sourceTraceOf("para one\n\npara two").sourced).toBe("para onepara two");
  });

  it("keeps a newline the file actually spells", () => {
    expect(sourceTraceOf("line one\nline two").sourced).toBe("line one\nline two");
  });

  it("drops the newline a hard break draws, because the file spells spaces", () => {
    expect(sourceTraceOf("line one  \nline two").sourced).toBe("line oneline two");
  });

  it("addresses the file through its own axis", () => {
    const markdown = "para one\n\npara two";
    const { sourced, runs } = sourceTraceOf(markdown);
    const at = sourced.indexOf("para two");
    const range = mdRangeOfProjection(runs, "sourced", at, at + "para two".length);
    expect(range).toEqual({ start: 10, end: 18 });
  });
});

describe("plain → markdown", () => {
  it("quotes exactly the characters selected inside prose", () => {
    const markdown = "We assume 6.1% today.";
    const { start, end } = plainAt(markdown, "6.1%");
    expect(quoteOf(markdown, start, end)).toBe("6.1%");
  });

  it("quotes the emphasis markers a selection crosses, as the file spells them", () => {
    const markdown = "We assume **6.1%** today.";
    const { start } = plainAt(markdown, "assume");
    const { end } = plainAt(markdown, "6.1%");
    expect(quoteOf(markdown, start, end)).toBe("assume **6.1%");
  });

  it("reaches inside a code span without quoting its backticks", () => {
    const markdown = "Run `npm test` first.";
    const { start, end } = plainAt(markdown, "npm test");
    expect(quoteOf(markdown, start, end)).toBe("npm test");
  });

  it("reaches inside a fence without quoting its fence lines", () => {
    const markdown = "```ts\nconst a = 1;\n```\n";
    const { start, end } = plainAt(markdown, "const a");
    expect(quoteOf(markdown, start, end)).toBe("const a");
  });

  it("quotes a whole escaped run rather than slicing offsets that do not line up", () => {
    const markdown = String.raw`A \* B`;
    const trace = sourceTraceOf(markdown);
    expect(trace.plain).toBe("A * B");
    const range = mdRangeOfProjection(trace.runs, "plain", 2, 3);
    expect(range).toEqual({ start: 0, end: markdown.length });
  });

  /**
   * The case the whole of UI-060 is about, at the level it is decided.
   *
   * `the\n\nnext hen` draws one `hen`, at plain offset 9. The trace used to close
   * the join up and report two, the first straddling it — so an index counted in
   * the DOM landed a character early and the anchor came back over `he\n\n`.
   */
  it("crosses a block join without inventing an occurrence on either side of it", () => {
    const markdown = "the\n\nnext hen";
    const trace = sourceTraceOf(markdown);
    expect(trace.plain).toBe("the\nnext hen");
    expect(trace.plain.indexOf("hen")).toBe(9);
    expect(quoteOf(markdown, 9, 12)).toBe("hen");
  });

  it("quotes the markdown between two blocks a selection spans, joins included", () => {
    const markdown = "the\n\nnext hen";
    expect(quoteOf(markdown, 0, 12)).toBe(markdown);
  });

  it("quotes nothing for a range that is only the renderer's own whitespace", () => {
    // The join between the two paragraphs, and nothing else.
    expect(quoteOf("the\n\nnext hen", 3, 4)).toBeNull();
  });

  it("picks the occurrence it was asked for, not the first one", () => {
    const markdown = "revisit the rate now, and revisit the rate later";
    const second = plainAt(markdown, "revisit the rate", 1);
    const range = mdRangeOfProjection(
      sourceTraceOf(markdown).runs,
      "plain",
      second.start,
      second.end,
    );
    expect(range).toEqual({ start: 26, end: 42 });
  });

  it("answers null for a range that touches no content", () => {
    expect(mdRangeOfProjection(sourceTraceOf("# Title\n").runs, "plain", 5, 5)).toBeNull();
    expect(mdRangeOfProjection([], "plain", 0, 3)).toBeNull();
  });

  /**
   * A stray space before a line break used to make the whole paragraph one
   * atomic run, because the rendered value and the source differed and nothing
   * explained why. `trim-lines` is the explanation, and the trace reproduces it,
   * so a selection of one word stays a selection of one word.
   */
  it("maps a paragraph whose lines carry trailing whitespace, character for character", () => {
    const markdown = "the rate is \nstale today";
    const trace = sourceTraceOf(markdown);
    expect(trace.plain).toBe("the rate is\nstale today");
    const { start, end } = plainAt(markdown, "stale");
    expect(quoteOf(markdown, start, end)).toBe("stale");
  });
});

describe("markdown → plain", () => {
  it("finds the rendered text an anchored range covers", () => {
    const markdown = "We assume 6.1% today.";
    const range = projectionRangeOfMd(sourceTraceOf(markdown).runs, "plain", 10, 14);
    expect(range).not.toBeNull();
    expect(sourceTraceOf(markdown).plain.slice(range?.start, range?.end)).toBe("6.1%");
  });

  it("strips the markup an anchor's quote carried", () => {
    const markdown = "We assume **6.1%** today.";
    const range = projectionRangeOfMd(sourceTraceOf(markdown).runs, "plain", 10, 18);
    expect(sourceTraceOf(markdown).plain.slice(range?.start, range?.end)).toBe("6.1%");
  });

  it("includes the join between two blocks a range spans", () => {
    const markdown = "the\n\nnext hen";
    const range = projectionRangeOfMd(sourceTraceOf(markdown).runs, "plain", 0, markdown.length);
    expect(sourceTraceOf(markdown).plain.slice(range?.start, range?.end)).toBe("the\nnext hen");
  });

  it("answers null for a range that is nothing but syntax", () => {
    const markdown = "## Rates\n";
    expect(projectionRangeOfMd(sourceTraceOf(markdown).runs, "plain", 0, 3)).toBeNull();
    expect(projectionRangeOfMd([], "plain", 0, 3)).toBeNull();
  });

  it("round-trips a quote through both directions", () => {
    const markdown = "The **first** rate and the second rate.";
    const forward = plainAt(markdown, "second rate");
    const md = mdRangeOfProjection(
      sourceTraceOf(markdown).runs,
      "plain",
      forward.start,
      forward.end,
    );
    expect(md).not.toBeNull();
    const back = projectionRangeOfMd(
      sourceTraceOf(markdown).runs,
      "plain",
      md?.start ?? 0,
      md?.end ?? 0,
    );
    expect(back).toEqual(forward);
  });
});

describe("the cache", () => {
  it("hands back the same trace for the same body", () => {
    expect(sourceTraceOf("one body")).toBe(sourceTraceOf("one body"));
  });

  it("forgets the oldest entry rather than growing with the session", () => {
    const first = sourceTraceOf("body 0");
    for (let index = 1; index <= SOURCE_TRACE_ENTRIES; index += 1) {
      sourceTraceOf(`body ${String(index)}`);
    }
    expect(sourceTraceOf("body 0")).not.toBe(first);
  });
});
