import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import type { PmNode } from "../editor/markdown/schema.js";
import { LEAF_NODES, serializeDoc, type TraceRun } from "../editor/markdown/serialize.js";
import { mdRangeToPm, pmRangeToMd, type PmSegment } from "./offsetMap.js";

/**
 * The offset map's suite, and the trace's.
 *
 * The oracle is deliberately **not** the trace: {@link pmTextBetween} walks the
 * ProseMirror JSON with ProseMirror's own size rules and reports the text in a
 * range. So every assertion below reads "the markdown range `x` maps to a
 * ProseMirror range whose text is `y`" — checked against an independent walk,
 * not against the machinery under test agreeing with itself.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../editor/markdown/fixtures");

/**
 * The text a ProseMirror range covers, by ProseMirror's counting: a text node
 * is its length, a leaf is one position, every other node opens and closes.
 */
function pmTextBetween(doc: PmNode, from: number, to: number): string {
  let out = "";
  const visit = (node: PmNode, at: number): number => {
    if (node.type === "text") {
      const text = node.text ?? "";
      const start = Math.max(from, at);
      const end = Math.min(to, at + text.length);
      if (end > start) out += text.slice(start - at, end - at);
      return text.length;
    }
    if (LEAF_NODES.has(node.type)) {
      // A leaf occupies one position and contributes no text; a `[[ref]]`
      // selected whole is reported by its markers, below.
      if (at >= from && at < to) out += "•";
      return 1;
    }
    let inner = at + 1;
    for (const child of node.content ?? []) inner += visit(child, inner);
    return inner + 1 - at;
  };
  let position = 0;
  for (const child of doc.content ?? []) position += visit(child, position);
  return out;
}

interface Traced {
  readonly markdown: string;
  readonly trace: readonly TraceRun[];
  readonly doc: PmNode;
}

function trace(markdown: string): Traced {
  const doc = parseMarkdown(markdown);
  const traced = serializeDoc(doc, { trace: true });
  return { markdown: traced.markdown, trace: traced.trace, doc };
}

/** The markdown range of the `nth` (default first) occurrence of a quote. */
function quoteRange(markdown: string, quote: string, nth = 0): { start: number; end: number } {
  let at = -1;
  for (let seen = 0; seen <= nth; seen += 1) at = markdown.indexOf(quote, at + 1);
  expect(at, `quote ${JSON.stringify(quote)} is in the fixture`).toBeGreaterThanOrEqual(0);
  return { start: at, end: at + quote.length };
}

/** What the editor shows for a markdown quote, joined across block segments. */
function shownFor(source: Traced, quote: string, nth = 0): string {
  const segments = mdRangeToPm(source.trace, quoteRange(source.markdown, quote, nth));
  return segments.map((segment) => pmTextBetween(source.doc, segment.from, segment.to)).join("|");
}

/* ── The trace itself ───────────────────────────────────────────────── */

describe("the position trace", () => {
  const source = trace(readFileSync(join(FIXTURES, "mixed-note.md"), "utf8"));

  it("quotes the markdown it claims, run for run", () => {
    for (const run of source.trace) {
      if (run.atomic) continue;
      expect(run.mdEnd - run.mdStart).toBe(run.pmTo - run.pmFrom);
      expect(source.markdown.slice(run.mdStart, run.mdEnd)).toBe(
        pmTextBetween(source.doc, run.pmFrom, run.pmTo),
      );
    }
  });

  it("is ordered and non-overlapping in both coordinate systems", () => {
    let md = 0;
    let pm = 0;
    for (const run of source.trace) {
      expect(run.mdStart).toBeGreaterThanOrEqual(md);
      expect(run.pmFrom).toBeGreaterThanOrEqual(pm);
      md = run.mdEnd;
      pm = run.pmTo;
    }
  });

  it("maps content only — the syntax between runs is unaddressed", () => {
    const covered = source.trace.reduce((total, run) => total + (run.mdEnd - run.mdStart), 0);
    expect(covered).toBeLessThan(source.markdown.length);
    // …and what is uncovered really is syntax: `## `, `- `, `**`, the fence.
    expect(source.markdown.slice(0, source.trace[0]?.mdStart ?? 0)).toBe("# ");
  });
});

/* ── TEST-90: markdown range → ProseMirror range, table-driven ──────── */

describe("markdown range → ProseMirror range", () => {
  const note = trace(readFileSync(join(FIXTURES, "mixed-note.md"), "utf8"));
  const refs = trace(readFileSync(join(FIXTURES, "refs.md"), "utf8"));

  const CASES: readonly (readonly [string, Traced, string, string])[] = [
    [
      "a plain paragraph",
      note,
      "We are comparing three lenders.",
      "We are comparing three lenders.",
    ],
    ["a heading's text", note, "Mortgage options", "Mortgage options"],
    ["inside **bold**", note, "30-year fixed", "30-year fixed"],
    ["across a bold boundary", note, "The **30-year fixed** quote", "The 30-year fixed quote"],
    ["inside a nested list item", note, "the origination fee", "the origination fee"],
    ["inside a fenced code block", note, "r = rate / 12", "r = rate / 12"],
    ["a whole fenced line plus its neighbour", note, "n = years * 12", "n = years * 12"],
    [
      "inside a blockquote",
      note,
      "treat anything older than a week",
      "treat anything older than a week",
    ],
    ["inside inline code", note, "amortization_schedule", "amortization_schedule"],
    ["a link's text", note, "the lender's page", "the lender's page"],
    ["at document start", note, "Mortgage", "Mortgage"],
    ["at document end", note, "in the export.", "in the export."],
    ["adjacent to a [[ref]]", refs, "This note builds on", "This note builds on"],
    ["an aliased ref's alias text", refs, "the earlier draft", "•"],
  ];

  it.each(CASES)("%s", (_name, source, quote, expected) => {
    expect(shownFor(source, quote)).toBe(expected);
  });

  it("snaps a start inside `## ` forward to the heading's first content character", () => {
    const heading = quoteRange(note.markdown, "## What we know");
    const segments = mdRangeToPm(note.trace, heading);
    expect(segments).toHaveLength(1);
    expect(pmTextBetween(note.doc, segments[0]?.from ?? 0, segments[0]?.to ?? 0)).toBe(
      "What we know",
    );
  });

  it("snaps an end inside `- ` back to the previous content character", () => {
    // From mid-sentence in one bullet through the next bullet's `- ` marker.
    const from = quoteRange(note.markdown, "quote is 6.4%");
    const marker = note.markdown.indexOf("- The 15-year", from.end);
    const segments = mdRangeToPm(note.trace, { start: from.start, end: marker + 2 });
    // The marker itself contributes nothing, so the range ends at the last
    // content character before it and produces one segment, not two.
    expect(segments.map((segment) => pmTextBetween(note.doc, segment.from, segment.to))).toEqual([
      "quote is 6.4%.",
    ]);
  });

  it("answers nothing for a range that is only syntax", () => {
    const fence = note.markdown.indexOf("```python");
    expect(mdRangeToPm(note.trace, { start: fence, end: fence + 3 })).toEqual([]);
    expect(mdRangeToPm(note.trace, { start: 5, end: 5 })).toEqual([]);
  });
});

/* ── TEST-93: a `[[ref]]` is one atomic run ─────────────────────────── */

describe("a [[ref]]", () => {
  const refs = trace(readFileSync(join(FIXTURES, "refs.md"), "utf8"));

  it("maps the whole node from an offset anywhere inside its bracket form", () => {
    const full = quoteRange(refs.markdown, "[[doc_a1b2c3]]");
    const whole = mdRangeToPm(refs.trace, full);
    expect(whole).toHaveLength(1);
    expect((whole[0]?.to ?? 0) - (whole[0]?.from ?? 0)).toBe(1);

    // One character in the middle of `doc_a1b2c3` — the same node.
    const inside = mdRangeToPm(refs.trace, { start: full.start + 5, end: full.start + 6 });
    expect(inside).toEqual(whole);
  });

  it("carries the node into a range that only clips its edge", () => {
    const full = quoteRange(refs.markdown, "[[doc_a1b2c3]]");
    const spanning = mdRangeToPm(refs.trace, { start: full.start - 3, end: full.start + 4 });
    expect(spanning).toHaveLength(1);
    expect(pmTextBetween(refs.doc, spanning[0]?.from ?? 0, spanning[0]?.to ?? 0)).toBe("on •");
  });

  it("is atomic in the trace, so no interior arithmetic is ever attempted", () => {
    const atomic = refs.trace.filter((run) => run.atomic);
    expect(atomic.length).toBeGreaterThan(0);
    for (const run of atomic) {
      expect(refs.markdown.slice(run.mdStart, run.mdEnd)).toMatch(/^\[\[doc_/);
    }
  });
});

/* ── TEST-94: a range spanning blocks is several decorations ────────── */

describe("a range spanning blocks", () => {
  const note = trace(readFileSync(join(FIXTURES, "mixed-note.md"), "utf8"));

  function spanning(first: string, last: string): PmSegment[] {
    const start = quoteRange(note.markdown, first).start;
    const end = quoteRange(note.markdown, last).end;
    return mdRangeToPm(note.trace, { start, end });
  }

  it("produces one segment per block for two blocks", () => {
    const segments = spanning("the earlier analysis", "What we know");
    expect(segments).toHaveLength(2);
    expect(new Set(segments.map((segment) => segment.block)).size).toBe(2);
  });

  it("produces one segment per block for three blocks", () => {
    const segments = spanning("the earlier analysis", "quote is 6.4%");
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => pmTextBetween(note.doc, segment.from, segment.to))).toEqual([
      "the earlier analysis is •.",
      "What we know",
      "The 30-year fixed quote is 6.4%",
    ]);
  });

  it("never returns a segment that crosses a block", () => {
    const segments = spanning("the earlier analysis", "quote is 6.4%");
    for (const segment of segments) {
      // A crossing segment would cover text from two blocks; the oracle joins
      // them with nothing, so the only way to check is the block ids, which are
      // distinct by construction.
      expect(segment.to).toBeGreaterThan(segment.from);
    }
    expect(segments.map((segment) => segment.block)).toEqual([
      ...new Set(segments.map((s) => s.block)),
    ]);
  });
});

/* ── TEST-91: the inverse, and the round trip ───────────────────────── */

describe("ProseMirror range → markdown range", () => {
  const note = trace(readFileSync(join(FIXTURES, "mixed-note.md"), "utf8"));

  it("returns the quote a selection covers, including the markup inside it", () => {
    const segments = mdRangeToPm(
      note.trace,
      quoteRange(note.markdown, "The **30-year fixed** quote"),
    );
    const first = segments[0];
    expect(first).toBeDefined();
    const back = pmRangeToMd(note.trace, { from: first?.from ?? 0, to: first?.to ?? 0 });
    expect(note.markdown.slice(back?.start ?? 0, back?.end ?? 0)).toBe(
      "The **30-year fixed** quote",
    );
  });

  it("round-trips every case in the table", () => {
    const quotes = [
      "We are comparing three lenders.",
      "Mortgage options",
      "30-year fixed",
      "the origination fee",
      "r = rate / 12",
      "treat anything older than a week",
      "amortization_schedule",
      "in the export.",
    ];
    for (const quote of quotes) {
      const range = quoteRange(note.markdown, quote);
      const segments = mdRangeToPm(note.trace, range);
      expect(segments, quote).toHaveLength(1);
      const back = pmRangeToMd(note.trace, {
        from: segments[0]?.from ?? 0,
        to: segments[0]?.to ?? 0,
      });
      expect(back, quote).toEqual(range);
      expect(mdRangeToPm(note.trace, back ?? range), quote).toEqual(segments);
    }
  });

  it("answers null for a caret and for a position with no content in it", () => {
    expect(pmRangeToMd(note.trace, { from: 3, to: 3 })).toBeNull();
    expect(pmRangeToMd(note.trace, { from: 10_000, to: 10_010 })).toBeNull();
  });

  it("quotes a whole ref node when the selection is inside one", () => {
    const refs = trace(readFileSync(join(FIXTURES, "refs.md"), "utf8"));
    const full = quoteRange(refs.markdown, "[[doc_z9y8x7|the earlier draft]]");
    const segments = mdRangeToPm(refs.trace, full);
    const back = pmRangeToMd(refs.trace, {
      from: segments[0]?.from ?? 0,
      to: segments[0]?.to ?? 0,
    });
    expect(back).toEqual(full);
  });
});

/* ── TEST-95: the whole fixture corpus ──────────────────────────────── */

describe("the fixture corpus", () => {
  const names = readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".md"))
    .sort();

  it("is the same corpus the round-trip suite runs over", () => {
    expect(names).toHaveLength(14);
  });

  it.each(names)("%s: every run quotes exactly the text it points at", (name) => {
    const source = trace(readFileSync(join(FIXTURES, name), "utf8"));
    expect(source.trace.length).toBeGreaterThan(0);
    for (const run of source.trace) {
      if (run.atomic) continue;
      expect(source.markdown.slice(run.mdStart, run.mdEnd)).toBe(
        pmTextBetween(source.doc, run.pmFrom, run.pmTo),
      );
    }
  });

  it.each(names)("%s: every run round-trips through both directions", (name) => {
    const source = trace(readFileSync(join(FIXTURES, name), "utf8"));
    for (const run of source.trace) {
      const back = pmRangeToMd(source.trace, { from: run.pmFrom, to: run.pmTo });
      expect(back, `${name} @ ${String(run.mdStart)}`).toEqual({
        start: run.mdStart,
        end: run.mdEnd,
      });
      const forward = mdRangeToPm(source.trace, back ?? { start: 0, end: 0 });
      expect(forward, `${name} @ ${String(run.mdStart)}`).toEqual([
        { from: run.pmFrom, to: run.pmTo, block: run.block },
      ]);
    }
  });

  it.each(names)("%s: covers a majority of the document's characters", (name) => {
    const source = trace(readFileSync(join(FIXTURES, name), "utf8"));
    const covered = source.trace.reduce((total, run) => total + (run.mdEnd - run.mdStart), 0);
    // Not a coverage target — a guard against a fixture whose constructs the
    // trace silently declines to map, which would otherwise pass every
    // assertion above by having nothing to assert.
    expect(covered / source.markdown.length).toBeGreaterThan(0.4);
  });
});
