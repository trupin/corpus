/** @vitest-environment jsdom */
import { MarkdownView } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderedTextOf } from "./renderedRange";
import { resetSourceTraceCache, sourceTraceOf } from "./sourceTrace";

/**
 * **The invariant, against the only oracle there is** (UI-060).
 *
 * `sourceTrace.ts` claims to produce the projection a renderer draws, and
 * `turnAnchors.ts` transfers an *occurrence index* across that claim: it counts
 * a quote's earlier occurrences in the DOM and looks that index up in the trace.
 * The transfer is sound exactly while the two strings are the same string. When
 * they are not, an index lands early and a comment is anchored to words nobody
 * selected — which is what PR #20 measured and what UI-060 exists to close.
 *
 * So the assertion here is one line, made against the real component rather than
 * against a model of it: **what `MarkdownView` draws is what the trace says it
 * draws**. Everything the module gets right about block joins, list wrapping,
 * hard breaks and trailing whitespace is a consequence of that line, and any
 * future divergence — a remark upgrade, a new plugin, a renderer change — turns
 * this red without anyone having to predict which construct it broke.
 *
 * `MarkdownView` is used directly rather than through `Turn`, because `Turn`
 * splits a body before rendering it and this is about the renderer.
 * `turnAnchors.test.tsx` covers the splitting.
 */

afterEach(cleanup);
beforeEach(resetSourceTraceCache);

function Host({ markdown, hardBreaks }: MarkdownHostProps): ReactElement {
  const [harness] = useState(() =>
    createCorpusTestHarness({ fetch: () => Promise.resolve(new Response("{}")) }),
  );
  return (
    <harness.Wrapper>
      <MarkdownView markdown={markdown} className="parity-body" hardBreaks={hardBreaks} />
    </harness.Wrapper>
  );
}

interface MarkdownHostProps {
  readonly markdown: string;
  readonly hardBreaks: boolean;
}

/** What a reader sees, read off the real DOM the real renderer produced. */
function drawnText(markdown: string, hardBreaks: boolean): string {
  const { container } = render(<Host markdown={markdown} hardBreaks={hardBreaks} />);
  const root = container.querySelector(".parity-body");
  if (root === null) throw new Error("the renderer produced no body");
  return renderedTextOf(root).text;
}

/**
 * Every markdown construct a turn is written in.
 *
 * The three rows of UI-060's measured table are the first three block cases;
 * the rest are here because a projection that agrees about paragraphs and
 * disagrees about blockquotes is no more usable than one that disagrees about
 * both.
 */
const FIXTURES: readonly (readonly [string, string])[] = [
  ["one paragraph", "just a sentence"],
  ["two paragraphs", "para one\n\npara two"],
  ["the measured collision", "the\n\nnext hen"],
  ["a tight list", "- foo\n- bar"],
  ["a loose list", "- foo\n\n- bar"],
  ["a nested list", "- foo\n  - deep\n- bar"],
  ["an ordered list", "1. one\n2. two"],
  ["a task list", "- [ ] open\n- [x] done"],
  ["a list item with a trailing paragraph", "- lead in\n\n  a second paragraph\n- next"],
  ["a blockquote", "> quoted\n\nafter"],
  ["a blockquote of two paragraphs", "> one\n>\n> two"],
  ["a list inside a blockquote", "> - a\n> - b"],
  ["a heading and a paragraph", "# Title\n\nbody text"],
  ["headings at three levels", "# One\n\n## Two\n\n### Three\n\nbody"],
  ["a thematic break", "a\n\n---\n\nb"],
  ["a fenced block", "before\n\n```ts\nconst a = 1;\n```\n\nafter"],
  ["a fenced block with no language", "before\n\n```\nplain\n```\n\nafter"],
  ["an indented code block", "before\n\n    indented\n\nafter"],
  ["a code span", "use `foo()` here"],
  ["emphasis and strong", "a **bold** and *ital* c"],
  ["a link", "see [text](http://x) end"],
  ["a table", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ["a table beside prose", "before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter"],
  ["a markdown hard break", "line one  \nline two"],
  ["a backslash hard break", "line one\\\nline two"],
  ["a typed newline", "line one\nline two"],
  ["a soft-wrapped paragraph", "the rate is stale\nand nobody revisited it\nsince June"],
  ["a line with trailing whitespace", "the rate is \nstale today"],
  ["an escape", "a \\* b"],
  ["an entity", "a &amp; b"],
  ["an image", "Look: ![a chart](attachments/th/t/c.png)"],
  ["a footnote", "a claim[^1]\n\n[^1]: the note"],
  ["a §5 underline", "the <u>rate</u> rose"],
  ["a §5 highlight", "the ==rate== rose"],
  ["a §5 coloured phrase", 'the [rate]{color="accent"} rose'],
  ["a §5 block attribute", '::: {align="center"}\ncentered\n:::'],
  ["everything at once", "# Title\n\n- foo\n- bar\n\n> quoted\n\n`code` and **bold**\n\ndone"],
];

describe("what the trace says the renderer draws", () => {
  for (const hardBreaks of [false, true]) {
    describe(hardBreaks ? "with hard breaks on (a user's turn)" : "with hard breaks off", () => {
      for (const [name, markdown] of FIXTURES) {
        it(`is what it draws for ${name}`, () => {
          expect(sourceTraceOf(markdown).plain).toBe(drawnText(markdown, hardBreaks));
        });
      }
    });
  }
});

/**
 * The two places the projections still part company, asserted rather than
 * omitted — an untested exception is indistinguishable from an untested defect.
 *
 * Both fall to `captureTurnAnchor`'s disagreement guard, so the cost is a
 * declined selection and never a misplaced anchor.
 */
describe("what the trace deliberately does not claim", () => {
  it("leaves raw HTML out, which the renderer draws as literal text", () => {
    // Matching it would mean drawing `<u>` and `</u>` as text too, and those are
    // SPEC.md §5's underline — the reader sees the styling and neither tag.
    const markdown = "<div>x</div>\n\nafter";
    expect(drawnText(markdown, false)).toBe("<div>x</div>\nafter");
    expect(sourceTraceOf(markdown).plain).toBe("after");
  });

  it("leaves a styling marker split across another inline node", () => {
    // `==a **b** c==` reaches the walk as three nodes and a delimiter scan of
    // any one of them finds no pair. The flat spelling, which is what people
    // write, agrees — the fixture list above pins it.
    const markdown = "the ==rate **rose**== today";
    expect(drawnText(markdown, false)).toBe("the rate rose today");
    expect(sourceTraceOf(markdown).plain).toBe("the ==rate rose== today");
  });
});
