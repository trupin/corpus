import { beforeEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import { SELECTOR_CONTEXT } from "../editor/selection.js";
import { mdRangeToPm } from "./offsetMap.js";
import {
  isCommentable,
  selectorFromSelection,
  type AnchorSelection,
} from "./selectorFromSelection.js";
import { resetSourceTraceCache } from "./sourceTrace.js";
import type { DocumentTrace } from "./traceCache.js";

/**
 * What a comment quotes. Every case here is a property of the *file*, not of
 * the screen — which is the point of computing it from the markdown.
 */

beforeEach(() => {
  resetSourceTraceCache();
});

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

/** The capture, or `null` — for the cases that are not about *why* it refused. */
function capture(
  source: DocumentTrace,
  range: { from: number; to: number },
  file = source.markdown,
): AnchorSelection | null {
  const result = selectorFromSelection(source, range, file);
  return result.ok ? result.selection : null;
}

const BODY =
  "The rate assumption comes from the broker, who quoted 6.1% on Tuesday and " +
  "will not confirm it in writing until Friday afternoon at the earliest.\n";

describe("the selector", () => {
  const source = traced(BODY);

  it("quotes the markdown exactly, with 32 characters of context each side", () => {
    const anchor = capture(source, select(source, "6.1%"));
    expect(anchor?.selector.exact).toBe("6.1%");
    expect(anchor?.selector.prefix).toHaveLength(SELECTOR_CONTEXT);
    expect(anchor?.selector.suffix).toHaveLength(SELECTOR_CONTEXT);
    const at = source.markdown.indexOf("6.1%");
    expect(anchor?.selector.prefix).toBe(source.markdown.slice(at - SELECTOR_CONTEXT, at));
    expect(anchor?.selector.suffix).toBe(source.markdown.slice(at + 4, at + 4 + SELECTOR_CONTEXT));
    expect(anchor?.range).toEqual({ start: at, end: at + 4 });
  });

  it("clamps the prefix at the start of the document", () => {
    const anchor = capture(source, select(source, "The rate"));
    expect(anchor?.selector.prefix).toBe("");
    expect(anchor?.selector.exact).toBe("The rate");
  });

  it("clamps the suffix at the end of the document", () => {
    const anchor = capture(source, select(source, "earliest."));
    // The body's single trailing newline is all that is left after the quote.
    expect(anchor?.selector.suffix.length).toBeLessThan(SELECTOR_CONTEXT);
    expect(anchor?.selector.suffix.trim()).toBe("");
  });

  it("does not trim or normalise anything", () => {
    const spaced = traced("a   b\n\nsecond\n");
    const anchor = capture(spaced, select(spaced, "a   b"));
    expect(anchor?.selector.exact).toBe("a   b");
  });

  it("quotes the markup a selection crosses, not what the screen shows", () => {
    const emphasised = traced("The **30-year fixed** quote is 6.4%.\n");
    const anchor = capture(emphasised, select(emphasised, "The **30-year fixed** quote"));
    expect(anchor?.selector.exact).toBe("The **30-year fixed** quote");
  });

  it("quotes across a block boundary, newlines and all", () => {
    const two = traced("First paragraph here.\n\nSecond paragraph here.\n");
    const anchor = capture(two, { from: 15, to: 30 });
    expect(anchor?.selector.exact).toContain("\n\n");
  });

  it("quotes a whole [[ref]] when the selection is inside one", () => {
    const refs = traced("See [[doc_a1b2c3]] for the rate.\n");
    const anchor = capture(refs, select(refs, "[[doc_a1b2c3]]"));
    expect(anchor?.selector.exact).toBe("[[doc_a1b2c3]]");
  });
});

/**
 * UI-068. The trace addresses the editor's *printing* of the document; the
 * server matches the quote against the **file**. On the files below those are
 * two different strings, and a selector cut from the printing quotes bytes the
 * document does not contain — an anchor orphaned at creation, before anyone has
 * read the comment.
 *
 * Every case is a trigger from UI-062's list, and the assertion is the same one
 * each time: `prefix + exact + suffix` is a slice of the file, so §6's rung 1
 * finds it where the selection was.
 */
describe("a file the editor would print differently", () => {
  /** What rung 1 of the ladder does: the framed quote, located in the file. */
  function rung1(file: string, anchor: AnchorSelection | null): number {
    if (anchor === null) return -1;
    const { prefix, exact, suffix } = anchor.selector;
    const framed = file.indexOf(prefix + exact + suffix);
    return framed === -1 ? -1 : framed + prefix.length;
  }

  /** Select `quote` as the editor spells it, and quote it out of `file`. */
  function comment(file: string, quote: string): AnchorSelection | null {
    const live = traced(file);
    expect(live.markdown).not.toBe(file);
    return capture(live, select(live, quote), file);
  }

  function expectsFaithful(file: string, quote: string, expected: string): void {
    const anchor = comment(file, quote);
    expect(anchor?.selector.exact).toBe(expected);
    // The whole selector, not just the quote: context invented by the printer
    // is what §6's rung 1 fails on, and what SERVER-071 cannot repair.
    expect(rung1(file, anchor)).toBe(anchor?.range.start);
    expect(file.slice(anchor?.range.start, anchor?.range.end)).toBe(expected);
  }

  it("quotes across the blank line a file keeps after its frontmatter", () => {
    expectsFaithful(
      "\n# Standup\n\n**Moushmi Verma** on repositioning Fernando under Mesbah.\n",
      "Moushmi Verma** on repositioning Fernando under Mesbah",
      "Moushmi Verma** on repositioning Fernando under Mesbah",
    );
  });

  /**
   * The reported selector, verbatim: `prefix: "rm |\n| Mesbah   | infra    |\n\n**"`
   * — padded cells that exist only in the printing. The file's own row is
   * single-spaced, and this is the one shape where the *quote itself* can
   * straddle the respelling.
   */
  it("quotes across a table the printer pads", () => {
    const file =
      "| who | area |\n| --- | ---- |\n| Fernando | platform |\n| Mesbah | infra |\n\n**Moushmi Verma** wrote it up.\n";
    const anchor = comment(file, "Moushmi Verma** wrote it up");
    expect(anchor?.selector.exact).toBe("Moushmi Verma** wrote it up");
    // The padding is the whole point: the printer's cells are not in the file.
    expect(traced(file).markdown).toContain("| Mesbah   | infra    |");
    expect(anchor?.selector.prefix).not.toContain("Mesbah   ");
    expect(file).toContain(
      (anchor?.selector.prefix ?? "") +
        (anchor?.selector.exact ?? "") +
        (anchor?.selector.suffix ?? ""),
    );
    expect(rung1(file, anchor)).toBe(anchor?.range.start);
  });

  it("quotes a cell of that table, in the file's spelling and not the padded one", () => {
    const file = "| who | area |\n| --- | ---- |\n| Fernando | platform |\n";
    expectsFaithful(file, "Fernando", "Fernando");
  });

  it("quotes across a hard break spelled as two trailing spaces", () => {
    expectsFaithful(
      "on repositioning  \nFernando under Mesbah.\n",
      "Fernando under Mesbah",
      "Fernando under Mesbah",
    );
  });

  it("quotes under a setext heading", () => {
    expectsFaithful("Standup\n=======\n\nThe rate is 6.1% today.\n", "6.1% today", "6.1% today");
  });

  it("quotes past an indented code block the printer fences", () => {
    expectsFaithful(
      "text\n\n    code line\n\nThe rate is 6.1% today.\n",
      "6.1% today",
      "6.1% today",
    );
  });

  /**
   * The reference token is in neither projection — `MarkdownView` draws a title,
   * not the token — so a selection of nothing else has no plain range to travel
   * through. The second rung catches it: the printing's quote occurs in the file
   * exactly once, and there is nowhere else it could have come from.
   */
  it("quotes a [[ref]] the plain projection cannot carry", () => {
    expectsFaithful("\nSee [[doc_a1b2c3]] for the rate.\n", "[[doc_a1b2c3]]", "[[doc_a1b2c3]]");
  });

  /**
   * The common path, stated as a claim rather than left implied: a file the
   * editor prints back byte for byte crosses nothing at all — `rebaseRange`
   * answers with the range it was given — so every case in the block above this
   * one is also the proof that a canonical document is unaffected.
   */
  it("is not a file the editor would print differently, and crosses nothing", () => {
    const file = "The rate is 6.1% today.\n";
    const live = traced(file);
    expect(live.markdown).toBe(file);
    const anchor = capture(live, select(live, "6.1%"), file);
    expect(anchor?.range).toEqual({ start: file.indexOf("6.1%"), end: file.indexOf("6.1%") + 4 });
  });
});

describe("a selection that cannot anchor", () => {
  const source = traced(BODY);

  it("is refused when it is empty", () => {
    expect(selectorFromSelection(source, { from: 4, to: 4 }, source.markdown)).toEqual({
      ok: false,
      reason: "no-quote",
    });
  });

  it("is refused when it is whitespace only", () => {
    const spaced = traced("word     word\n");
    const gap = spaced.markdown.indexOf("     ");
    const segments = mdRangeToPm(spaced.trace, { start: gap, end: gap + 5 });
    const first = segments[0];
    expect(
      selectorFromSelection(
        spaced,
        { from: first?.from ?? 0, to: first?.to ?? 0 },
        spaced.markdown,
      ),
    ).toEqual({ ok: false, reason: "no-quote" });
  });

  it("is refused when it quotes no content at all", () => {
    expect(selectorFromSelection(source, { from: 10_000, to: 10_020 }, source.markdown)).toEqual({
      ok: false,
      reason: "no-quote",
    });
  });

  /**
   * The refusal UI-068 adds, and the one the comment path must say out loud: the
   * words are real, but they cannot be named in the file's own spelling. Never a
   * quote of a document that does not exist.
   */
  it("is refused, and says so distinctly, when the file does not contain the words", () => {
    const live = traced("\nSee [[doc_a1b2c3]] for the rate.\n");
    const elsewhere = "A file about something else entirely.\n";
    expect(selectorFromSelection(live, select(live, "[[doc_a1b2c3]]"), elsewhere)).toEqual({
      ok: false,
      reason: "not-in-file",
    });
  });

  it("is what the toolbar's disabled state is computed from", () => {
    expect(isCommentable("  \n ")).toBe(false);
    expect(isCommentable("")).toBe(false);
    expect(isCommentable(" a ")).toBe(true);
  });
});
