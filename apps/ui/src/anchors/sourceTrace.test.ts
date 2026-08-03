import { beforeEach, describe, expect, it } from "vitest";
import {
  mdRangeOfPlain,
  plainRangeOfMd,
  resetSourceTraceCache,
  SOURCE_TRACE_ENTRIES,
  sourceTraceOf,
} from "./sourceTrace";

beforeEach(() => {
  resetSourceTraceCache();
});

/** The markdown a plain range quotes, which is what a selector's `exact` is. */
function quoteOf(markdown: string, plainStart: number, plainEnd: number): string | null {
  const range = mdRangeOfPlain(sourceTraceOf(markdown).runs, plainStart, plainEnd);
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
  it("drops every piece of syntax the printer wrote", () => {
    const { plain } = sourceTraceOf("## Rates\n\nWe assume **6.1%** today.\n");
    expect(plain).toBe("RatesWe assume 6.1% today.");
  });

  it("keeps a list's items and drops its bullets", () => {
    expect(sourceTraceOf("- one\n- two\n").plain).toBe("onetwo");
  });

  it("keeps a link's text and drops its destination", () => {
    expect(sourceTraceOf("See [the model](http://x/rate) now.").plain).toBe("See the model now.");
  });

  it("keeps a code span's value and drops its backticks", () => {
    expect(sourceTraceOf("Run `npm test` first.").plain).toBe("Run npm test first.");
  });

  it("keeps a fence's code and drops its fence lines", () => {
    expect(sourceTraceOf("```ts\nconst a = 1;\n```\n").plain).toBe("const a = 1;");
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

  it("keeps a table's cells", () => {
    const markdown = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(sourceTraceOf(markdown).plain).toBe("ab12");
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
    // What the file says between those two points — the server's ladder matches
    // literally, and a tidied quote is a quote of a document that does not exist.
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
    const range = mdRangeOfPlain(trace.runs, 2, 3);
    // The run's markdown is `A \* B` and its text is `A * B`: a partial hit
    // quotes the whole run rather than an offset that means nothing.
    expect(range).toEqual({ start: 0, end: markdown.length });
  });

  it("picks the occurrence it was asked for, not the first one", () => {
    const markdown = "revisit the rate now, and revisit the rate later";
    const second = plainAt(markdown, "revisit the rate", 1);
    const range = mdRangeOfPlain(sourceTraceOf(markdown).runs, second.start, second.end);
    expect(range).toEqual({ start: 26, end: 42 });
  });

  it("answers null for a range that touches no content", () => {
    expect(mdRangeOfPlain(sourceTraceOf("# Title\n").runs, 5, 5)).toBeNull();
    expect(mdRangeOfPlain([], 0, 3)).toBeNull();
  });
});

describe("markdown → plain", () => {
  it("finds the rendered text an anchored range covers", () => {
    const markdown = "We assume 6.1% today.";
    const range = plainRangeOfMd(sourceTraceOf(markdown).runs, 10, 14);
    expect(range).not.toBeNull();
    expect(sourceTraceOf(markdown).plain.slice(range?.start, range?.end)).toBe("6.1%");
  });

  it("strips the markup an anchor's quote carried", () => {
    const markdown = "We assume **6.1%** today.";
    // `**6.1%**` as written in the file.
    const range = plainRangeOfMd(sourceTraceOf(markdown).runs, 10, 18);
    expect(sourceTraceOf(markdown).plain.slice(range?.start, range?.end)).toBe("6.1%");
  });

  it("answers null for a range that is nothing but syntax", () => {
    const markdown = "## Rates\n";
    expect(plainRangeOfMd(sourceTraceOf(markdown).runs, 0, 3)).toBeNull();
    expect(plainRangeOfMd([], 0, 3)).toBeNull();
  });

  it("round-trips a quote through both directions", () => {
    const markdown = "The **first** rate and the second rate.";
    const forward = plainAt(markdown, "second rate");
    const md = mdRangeOfPlain(sourceTraceOf(markdown).runs, forward.start, forward.end);
    expect(md).not.toBeNull();
    const back = plainRangeOfMd(sourceTraceOf(markdown).runs, md?.start ?? 0, md?.end ?? 0);
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
