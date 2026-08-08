/** @vitest-environment jsdom */
import type { ThreadTurn } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SELECTOR_CONTEXT, type TextQuoteSelector } from "../editor/selection";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import {
  captureTurnAnchor,
  partContaining,
  renderedRangeOfTurnAnchor,
  spanContaining,
  turnSourceParts,
  turnSpans,
} from "./turnAnchors";
import { Turn } from "./Turn";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const REPEATED =
  "Let's revisit the rate assumption.\n\n" +
  "I said revisit the rate assumption because 6.1% looks stale.";

function turnFixture(overrides: Partial<ThreadTurn> = {}): ThreadTurn {
  return {
    author: "user",
    ts: "2026-08-03T10:00:00.000Z",
    body: REPEATED,
    model: null,
    ...overrides,
  };
}

/** The thread file a turn lives in — what the server resolves selectors against. */
function threadBodyOf(...turns: readonly ThreadTurn[]): string {
  return turns.map((turn) => `## ${turn.author} · ${turn.ts}\n\n${turn.body}\n`).join("\n");
}

function Host({ turn }: { readonly turn: ThreadTurn }): ReactElement {
  const [harness] = useState(() =>
    createCorpusTestHarness({ fetch: () => Promise.resolve(new Response("{}")) }),
  );
  return (
    <harness.Wrapper>
      <Turn
        threadId="th_a"
        turn={turn}
        answeredForm={null}
        onOpenRef={() => undefined}
        onDelete={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

/** The turn's rendered bodies, in the order `turnSourceParts` describes them. */
function rootsOf(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll(".turn-markdown")];
}

/** A range over the `nth` occurrence of `phrase`, built without the code under test. */
function selectNth(root: Element, phrase: string, nth = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let from = 0; ;) {
      const at = text.indexOf(phrase, from);
      if (at === -1) break;
      if (seen === nth) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + phrase.length);
        return range;
      }
      seen += 1;
      from = at + phrase.length;
    }
  }
  throw new Error(`no occurrence ${String(nth)} of "${phrase}"`);
}

/**
 * Rungs 1–2 of SPEC.md §6's ladder, as `apps/server/src/anchors/resolve.ts`
 * implements them — restated here because `apps/ui` may not import the server,
 * and because what this suite is really asserting is *where the server will
 * land*, not what the UI computed.
 */
function resolveExact(body: string, selector: TextQuoteSelector): number {
  if (selector.prefix !== "" || selector.suffix !== "") {
    const at = body.indexOf(selector.prefix + selector.exact + selector.suffix);
    if (at !== -1) return at + selector.prefix.length;
  }
  const first = body.indexOf(selector.exact);
  return first !== -1 && body.indexOf(selector.exact, first + 1) === -1 ? first : -1;
}

describe("the parts a turn renders", () => {
  it("describes the one body an ordinary turn renders", () => {
    const turn = turnFixture();
    const { container } = render(<Host turn={turn} />);
    expect(turnSourceParts(turn)).toEqual([{ source: REPEATED, base: 0 }]);
    expect(rootsOf(container)).toHaveLength(1);
  });

  it("stops at the trace and at the attachment references, which are not prose", () => {
    const turn = turnFixture({
      author: "agent",
      body: "The answer.\n\n![c.png](attachments/th_a/t/c.png)\n↳ filed into finance/",
    });
    const parts = turnSourceParts(turn);
    expect(parts).toEqual([{ source: "The answer.", base: 0 }]);
    // Every part is a contiguous slice of the turn at its own base — the
    // invariant the framing rests on.
    expect(turn.body.slice(0, "The answer.".length)).toBe("The answer.");
  });

  it("describes both bodies a form fence splits, and stays index-aligned with them", () => {
    const turn = turnFixture({
      author: "agent",
      body: "Before the form.\n\n```form\nprompt: Pick\noptions: [a, b]\n```\n\nAfter the form.",
    });
    const parts = turnSourceParts(turn);
    const { container } = render(<Host turn={turn} />);
    const roots = rootsOf(container);
    expect(parts.map((part) => part.source)).toEqual(["Before the form.", "After the form."]);
    expect(roots).toHaveLength(2);
    expect(roots[0]?.textContent).toContain("Before the form.");
    expect(roots[1]?.textContent).toContain("After the form.");
    // The second part is a slice of the turn at its stated base.
    const after = parts[1];
    expect(after).toBeDefined();
    expect(
      turn.body.slice(after?.base ?? 0, (after?.base ?? 0) + (after?.source.length ?? 0)),
    ).toBe("After the form.");
  });

  it("keeps a body for an attachment-only turn, so the indexes still line up", () => {
    const turn = turnFixture({ body: "![c.png](attachments/th_a/t/c.png)" });
    const { container } = render(<Host turn={turn} />);
    expect(turnSourceParts(turn)).toEqual([{ source: "", base: 0 }]);
    expect(rootsOf(container)).toHaveLength(1);
  });
});

describe("a selection inside a turn", () => {
  it("anchors to the occurrence the user selected, not to the first one", () => {
    const turn = turnFixture();
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    expect(root).toBeDefined();
    const part = turnSourceParts(turn)[0];
    expect(part).toBeDefined();

    const captured = captureTurnAnchor({
      root: root as Element,
      part: part ?? { source: "", base: 0 },
      turnBody: turn.body,
      range: selectNth(root as Element, "revisit the rate assumption", 1),
    });

    expect(captured).not.toBeNull();
    const selector = captured?.selector as TextQuoteSelector;
    expect(selector.exact).toBe("revisit the rate assumption");
    // The framing a document selection produces: `SELECTOR_CONTEXT` characters
    // on each side, taken from the turn as the file spells it.
    expect(selector.prefix).toHaveLength(SELECTOR_CONTEXT);
    expect(selector.prefix.endsWith("I said ")).toBe(true);
    expect(selector.suffix).toBe(" because 6.1% looks stale.");

    // Where the *server* will land it, in the thread file the anchor is written
    // into: the second occurrence, which is the one that was selected.
    const body = threadBodyOf(turn);
    const second = body.indexOf("revisit the rate assumption", body.indexOf("I said "));
    expect(resolveExact(body, selector)).toBe(second);
  });

  it("would have landed on the wrong occurrence with `exact` alone — the PR #19 failure", () => {
    const turn = turnFixture();
    const body = threadBodyOf(turn);
    const first = body.indexOf("revisit the rate assumption");
    const second = body.indexOf("revisit the rate assumption", first + 1);
    expect(second).toBeGreaterThan(first);
    // Rung 2 requires uniqueness, so a context-free selector does not resolve at
    // all here — and rung 1 with a *wrong* framing would land on the first.
    expect(
      resolveExact(body, { exact: "revisit the rate assumption", prefix: "", suffix: "" }),
    ).toBe(-1);
    expect(
      resolveExact(body, { exact: "revisit the rate assumption", prefix: "Let's ", suffix: "." }),
    ).toBe(first);
  });

  it("quotes the file's own spelling when the selection crosses emphasis", () => {
    const turn = turnFixture({ body: "We assume **6.1%** today." });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const range = document.createRange();
    const paragraph = root?.querySelector("p");
    range.setStart(paragraph?.firstChild as Node, 3);
    range.setEnd(paragraph?.querySelector("strong")?.firstChild as Node, 4);
    const captured = captureTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      turnBody: turn.body,
      range,
    });
    expect(captured?.selector.exact).toBe("assume **6.1%");
    expect(resolveExact(turn.body, captured?.selector as TextQuoteSelector)).toBe(3);
  });

  it("reaches inside a code span without quoting its backticks", () => {
    const turn = turnFixture({ body: "Run `npm test` before pushing." });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const captured = captureTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      turnBody: turn.body,
      range: selectNth(root as Element, "npm test"),
    });
    expect(captured?.selector.exact).toBe("npm test");
    expect(captured?.range).toEqual({ start: 5, end: 13 });
  });

  it("anchors into the second body of a turn a form splits, at its own base", () => {
    const turn = turnFixture({
      author: "agent",
      body: "Before.\n\n```form\nprompt: Pick\noptions: [a, b]\n```\n\nThe rate is stale.",
    });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[1];
    const part = turnSourceParts(turn)[1];
    expect(root).toBeDefined();
    expect(part).toBeDefined();
    const captured = captureTurnAnchor({
      root: root as Element,
      part: part ?? { source: "", base: 0 },
      turnBody: turn.body,
      range: selectNth(root as Element, "rate is stale"),
    });
    expect(captured?.selector.exact).toBe("rate is stale");
    expect(turn.body.slice(captured?.range.start, captured?.range.end)).toBe("rate is stale");
    expect(captured?.selector.prefix.endsWith("The ")).toBe(true);
  });

  it("quotes a `[[ref]]` as the file spells it, not as the title it renders as", () => {
    const turn = turnFixture({ body: "See [[doc_a1b2c3]] for the rate." });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    // A selection over the whole sentence, whose middle is a *title* the file
    // does not contain. Both projections leave the title out, so the two agree
    // about the words around it and the quote is the token itself.
    const range = document.createRange();
    range.selectNodeContents(root as Element);
    const captured = captureTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      turnBody: turn.body,
      range,
    });
    expect(captured?.selector.exact).toBe("See [[doc_a1b2c3]] for the rate.");
    expect(resolveExact(turn.body, captured?.selector as TextQuoteSelector)).toBe(0);
  });

  /**
   * PR #20 review, MINOR. `mdast-util-to-hast` puts a `"\n"` text node between
   * sibling blocks and beside every `<br>`; `sourceTrace`'s walk emits nothing
   * for either. So the rendered text and the trace's `plain` carry different
   * *whitespace*, and an occurrence that exists only in the concatenated `plain`
   * used to shift the index — anchoring `hen` to `he\n\nn`, straddling the
   * paragraph break. The exact case the reviewer measured.
   */
  it("declines rather than anchoring a selection to a block join", () => {
    const turn = turnFixture({ body: "the\n\nnext hen" });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const captured = captureTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      turnBody: turn.body,
      range: selectNth(root as Element, "hen"),
    });
    // Pre-fix this returned an anchor over `he\n\n` — the words either side of
    // the paragraph break rather than the ones selected. The guarantee made here
    // is *refusal*, not correctness: the two projections disagree about how many
    // times `hen` appears (once as rendered, twice with the join closed up), and
    // an occurrence index is not transferable across that disagreement.
    //
    // Anchoring this correctly is UI-060. It needs the source trace to reproduce
    // `mdast-util-to-hast`'s join rules exactly, which is a bigger change than a
    // review fix and would put the currently-working typed-newline case at risk.
    expect(captured).toBeNull();
  });

  it("still anchors normally when the join manufactures no occurrence", () => {
    // The guard is scoped to disagreement, not to block joins in general: two
    // paragraphs are fine as long as closing the join up does not invent another
    // copy of the quote.
    const turn = turnFixture({ body: "first para\n\nsecond para with target" });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const captured = captureTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      turnBody: turn.body,
      range: selectNth(root as Element, "target"),
    });
    expect(captured?.selector.exact).toBe("target");
    expect(turn.body.slice(captured?.range.start, captured?.range.end)).toBe("target");
  });

  it("declines a whitespace-only selection — `exact` is min(1) on the wire", () => {
    const turn = turnFixture({ body: "a   b" });
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const text = root?.querySelector("p")?.firstChild;
    const range = document.createRange();
    range.setStart(text as Node, 1);
    range.setEnd(text as Node, 4);
    expect(
      captureTurnAnchor({
        root: root as Element,
        part: { source: turn.body, base: 0 },
        turnBody: turn.body,
        range,
      }),
    ).toBeNull();
  });
});

describe("an anchored range back onto the rendering", () => {
  it("finds the occurrence the anchor resolved to, not the first one", () => {
    const turn = turnFixture();
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const second = turn.body.indexOf(
      "revisit the rate assumption",
      turn.body.indexOf("revisit the rate assumption") + 1,
    );
    const offsets = renderedRangeOfTurnAnchor({
      root: root as Element,
      part: { source: turn.body, base: 0 },
      range: { start: second, end: second + "revisit the rate assumption".length },
    });
    const rendered = root?.textContent ?? "";
    expect(offsets).not.toBeNull();
    expect(rendered.slice(offsets?.start, offsets?.end)).toBe("revisit the rate assumption");
    // …and it is the *second* one: the first sits earlier in the rendered text.
    expect(offsets?.start).toBeGreaterThan(rendered.indexOf("revisit the rate assumption"));
  });

  it("round-trips a capture back to the words that were selected", () => {
    const turn = turnFixture();
    const { container } = render(<Host turn={turn} />);
    const root = rootsOf(container)[0];
    const part = { source: turn.body, base: 0 };
    const captured = captureTurnAnchor({
      root: root as Element,
      part,
      turnBody: turn.body,
      range: selectNth(root as Element, "revisit the rate assumption", 1),
    });
    expect(captured).not.toBeNull();
    expect(
      renderedRangeOfTurnAnchor({
        root: root as Element,
        part,
        range: captured?.range ?? { start: 0, end: 0 },
      }),
    ).toEqual(captured?.rendered);
  });
});

describe("locating turns in the thread file", () => {
  it("gives each turn its byte range, in order", () => {
    const one = turnFixture({ ts: "2026-08-03T10:00:00.000Z", body: "same words" });
    const two = turnFixture({ ts: "2026-08-03T10:01:00.000Z", body: "same words" });
    const body = threadBodyOf(one, two);
    const spans = turnSpans(body, [one, two]);
    expect(spans).toHaveLength(2);
    // The cursor only moves forward, so identical turns cannot both match the
    // first occurrence.
    expect(spans[0]?.start).toBeLessThan(spans[1]?.start ?? 0);
    expect(body.slice(spans[1]?.start, spans[1]?.end)).toBe("same words");
  });

  it("skips a turn whose text the file does not carry", () => {
    const present = turnFixture({ body: "present" });
    const missing = turnFixture({ ts: "2026-08-03T10:02:00.000Z", body: "elsewhere" });
    expect(turnSpans(threadBodyOf(present), [present, missing])).toHaveLength(1);
  });

  it("answers which turn an anchored range belongs to", () => {
    const one = turnFixture({ body: "first turn" });
    const two = turnFixture({ ts: "2026-08-03T10:01:00.000Z", body: "second turn" });
    const body = threadBodyOf(one, two);
    const spans = turnSpans(body, [one, two]);
    const at = body.indexOf("second");
    expect(spanContaining(spans, { start: at, end: at + 6 })?.ts).toBe(two.ts);
    expect(spanContaining(spans, { start: 0, end: 2 })).toBeUndefined();
  });

  it("answers which rendered body a turn-local range belongs to", () => {
    const parts = [
      { source: "before", base: 0 },
      { source: "after", base: 20 },
    ];
    expect(partContaining(parts, { start: 21, end: 24 })?.index).toBe(1);
    expect(partContaining(parts, { start: 8, end: 10 })).toBeUndefined();
  });
});
