import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import { threadRowFixture } from "../testing/readerFixture.js";
import type { TextQuoteSelector } from "../editor/selection.js";
import {
  anchoredSummary,
  detachedThreads,
  isPlaced,
  offsetsComparable,
  placeAnchors,
  segmentsOf,
  summaryFromAnchor,
  unplacedThreads,
  type AnchoredThread,
} from "./anchorPlacement.js";
import { mdRangeToPm, pmRangeToMd, type MdRange, type PmRange } from "./offsetMap.js";
import { selectorFromSelection } from "./selectorFromSelection.js";
import { traceOfBody, type DocumentTrace } from "./traceCache.js";

/**
 * Turning the server's answer into something drawable — and refusing to draw
 * when the two coordinate systems cannot be reconciled.
 */

const BODY = "The rate is 6.1% today.\n\nThe second paragraph mentions Friday.\n";

function source(markdown = BODY): DocumentTrace {
  const traced = serializeDoc(parseMarkdown(markdown), { trace: true });
  return { markdown: traced.markdown, trace: traced.trace };
}

function anchor(overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  const start = BODY.indexOf("6.1%");
  return {
    anchorId: "anc_1",
    threadId: "th_1",
    threadStatus: "open",
    selector: { exact: "6.1%", prefix: "The rate is ", suffix: " today." },
    range: { start, end: start + 4 },
    orphaned: false,
    ...overrides,
  };
}

function row(overrides: Partial<DocRow> = {}): DocRow {
  return threadRowFixture({ id: "th_1", parent: "doc_1", turnCount: 3, ...overrides });
}

/** What each segment quotes: one contiguous slice of the markdown, markup and all. */
// `PmRange`, not `PmSegment`: these helpers only ever read `from`/`to`, and a
// rebased placement hands back plain ranges. Demanding the narrower type made
// the test file disagree with the code it tests.
function quoted(traced: DocumentTrace, segments: readonly PmRange[]): string[] {
  return segments.map((segment) => {
    const md = pmRangeToMd(traced.trace, segment);
    return md === null ? "" : traced.markdown.slice(md.start, md.end);
  });
}

/**
 * What the reader sees under the highlight: the *content* the segments cover,
 * run by run, with the syntax between runs left out — which is what a
 * ProseMirror inline decoration can express and all it can express.
 */
function underHighlight(traced: DocumentTrace, segments: readonly PmRange[]): string {
  let text = "";
  for (const segment of segments) {
    for (const run of traced.trace) {
      const from = Math.max(segment.from, run.pmFrom);
      const to = Math.min(segment.to, run.pmTo);
      if (to <= from || run.atomic) continue;
      text += traced.markdown.slice(
        run.mdStart + (from - run.pmFrom),
        run.mdStart + (to - run.pmFrom),
      );
    }
  }
  return text;
}

describe("placing an anchor", () => {
  it("puts the highlight where the server's character range says", () => {
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor()],
      rows: [row()],
      body: BODY,
      source: source(),
    });
    expect(placed?.placement.segments).toHaveLength(1);
    expect(placed?.placement.turnCount).toBe(3);
    expect(placed?.quote).toBe("6.1%");
  });

  it("marks a resolved thread's placement resolved", () => {
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor({ threadStatus: "resolved" })],
      rows: [row({ status: "resolved" })],
      body: BODY,
      source: source(),
    });
    expect(placed?.placement.resolved).toBe(true);
  });

  it("gives an orphan no segments at all", () => {
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor({ orphaned: true, range: null })],
      rows: [row()],
      body: BODY,
      source: source(),
    });
    expect(placed?.placement.segments).toEqual([]);
    expect(placed?.orphaned).toBe(true);
  });

  it("orders anchors by where they appear in the document", () => {
    const second = BODY.indexOf("Friday");
    const placed = placeAnchors({
      rowsSettled: true,
      anchors: [
        anchor({
          anchorId: "anc_2",
          threadId: "th_2",
          range: { start: second, end: second + 6 },
          selector: { exact: "Friday", prefix: "", suffix: "" },
        }),
        anchor(),
      ],
      rows: [row(), row({ id: "th_2" })],
      body: BODY,
      source: source(),
    });
    expect(placed.map((thread) => thread.threadId)).toEqual(["th_1", "th_2"]);
  });

  it("never searches for the anchor's text — three copies, one highlight", () => {
    const repeated = "rate rate rate\n";
    const at = repeated.indexOf("rate", 5);
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [
        anchor({
          range: { start: at, end: at + 4 },
          selector: { exact: "rate", prefix: "rate ", suffix: " rate" },
        }),
      ],
      rows: [row()],
      body: repeated,
      source: source(repeated),
    });
    // The middle one: position 6 in markdown is position 7 in ProseMirror.
    expect(placed?.placement.segments).toEqual([{ from: 6, to: 10, block: 1 }]);
  });
});

describe("offsets the trace cannot vouch for", () => {
  it("accepts a body that is already canonical", () => {
    expect(offsetsComparable(BODY, BODY)).toBe(true);
  });

  it("accepts a same-length respelling, which moves no offset", () => {
    expect(offsetsComparable("* one\n* two\n", "- one\n- two\n")).toBe(true);
    expect(offsetsComparable("_a_ and __b__\n", "*a* and **b**\n")).toBe(true);
  });

  it("refuses a respelling that changes the length", () => {
    expect(offsetsComparable("Title\n=====\n\nbody\n", "# Title\n\nbody\n")).toBe(false);
  });

  /**
   * UI-027. The one difference the check used to reject that shifts nothing:
   * the file's tail. The serializer ends every document with exactly one
   * newline; the server returns the body it was handed, and a creation whose
   * body ended without one is stored without one. Every character keeps its
   * index either way, so the offsets are comparable — and treating them as
   * incomparable meant *no document created that way ever showed a highlight*.
   */
  describe("the file's tail", () => {
    it("accepts a body the serializer would only add a final newline to", () => {
      expect(offsetsComparable("The rate is 6.1% today.", "The rate is 6.1% today.\n")).toBe(true);
    });

    it("accepts a body with newlines to spare at the end", () => {
      expect(offsetsComparable("one\n\ntwo\n\n\n", "one\n\ntwo\n")).toBe(true);
    });

    it("still judges everything before the tail by the same rule", () => {
      expect(offsetsComparable("Title\n=====\n\nbody", "# Title\n\nbody\n")).toBe(false);
      expect(offsetsComparable("* one\n* two", "- one\n- two\n")).toBe(true);
    });

    it("places the highlight on a body that ends without a newline", () => {
      const raw = "The rate is 6.1% today.";
      const [placed] = placeAnchors({
        rowsSettled: true,
        anchors: [anchor({ range: { start: 12, end: 16 } })],
        rows: [row()],
        body: raw,
        source: source(raw),
      });
      expect(placed?.placement.segments).toEqual([{ from: 13, to: 17, block: 1 }]);
    });
  });

  /**
   * PR #10 finding 18. Total length equality was the licence, and normalisation
   * both shortens (setext → ATX) and lengthens (indented code → fenced). One of
   * each in the same document restores the total while shifting every offset
   * between them — the case a length check cannot see and a highlight over the
   * wrong sentence is the price of.
   */
  describe("a shortening and a lengthening construct that cancel out", () => {
    const raw = "Title\n=====\n\n    code\n";
    const canonical = serializeDoc(parseMarkdown(raw));

    it("really does come back to the same total length", () => {
      expect(canonical).toBe("# Title\n\n```\ncode\n```\n");
      expect(canonical.length).toBe(raw.length);
    });

    it("is refused all the same, because the lines moved", () => {
      expect(offsetsComparable(raw, canonical)).toBe(false);
    });

    /**
     * UI-062. Refusing the offsets is still right; refusing to place the anchor
     * is not, and used to be the same decision. The two spellings render the
     * same characters, so the range travels through that shared projection
     * (`rebaseRange`) and lands on the words it names — never on the paragraph
     * a raw offset would have hit.
     */
    it("places it through the rendered text rather than the raw offsets", () => {
      const traced = source(raw);
      const [placed] = placeAnchors({
        rowsSettled: true,
        anchors: [anchor({ range: { start: 0, end: 5 } })],
        rows: [row()],
        body: raw,
        source: traced,
      });
      expect(quoted(traced, placed?.placement.segments ?? [])).toEqual(["Title"]);
      expect(placed?.orphaned).toBe(false);
    });
  });

  it("refuses a same-length respelling that redistributes characters across lines", () => {
    // Same total, same line count, different line lengths: an offset in the
    // first line is a different character in the two spellings.
    expect(offsetsComparable("abcd\nef\n", "ab\ncdef\n")).toBe(false);
  });

  it("draws the highlight over the words the offsets name, not the ones they land on", () => {
    const raw = "Title\n=====\n\nThe rate is 6.1% today.\n";
    const traced = source(raw);
    const start = raw.indexOf("6.1%");
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor({ range: { start, end: start + 4 } })],
      rows: [row()],
      body: raw,
      source: traced,
    });
    expect(quoted(traced, placed?.placement.segments ?? [])).toEqual(["6.1%"]);
    // …and it is not called an orphan, because it is not one.
    expect(placed?.orphaned).toBe(false);
  });

  /**
   * The refusal that remains. When the two spellings do not even render the
   * same characters there is no shared projection to travel through, and a
   * placement would be a guess — so the thread is listed instead of drawn
   * (`unplacedThreads`), and never given a position it does not have.
   */
  it("draws nothing when the two spellings say different things", () => {
    const raw = "Title\n=====\n\nThe rate is 6.1% today.\n";
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor({ range: { start: 24, end: 28 } })],
      rows: [row()],
      body: raw,
      source: source("Heading\n\nA different sentence entirely.\n"),
    });
    expect(placed?.placement.segments).toEqual([]);
    expect(placed?.orphaned).toBe(false);
    expect(unplacedThreads([placed as AnchoredThread]).map((each) => each.id)).toEqual(["th_1"]);
  });
});

describe("the placement rule, one anchor at a time", () => {
  it("reads a canonical body's offsets straight off the trace", () => {
    expect(segmentsOf(anchor(), BODY, source())).toEqual([{ from: 13, to: 17, block: 1 }]);
  });

  it("reads a respelt body's offsets through the rendered text", () => {
    const raw = `\n${BODY}`;
    const start = raw.indexOf("6.1%");
    expect(segmentsOf(anchor({ range: { start, end: start + 4 } }), raw, source(raw))).toEqual([
      { from: 13, to: 17, block: 1 },
    ]);
  });

  it("places nothing for an orphan, whatever range came with it", () => {
    expect(segmentsOf(anchor({ orphaned: true }), BODY, source())).toEqual([]);
    expect(segmentsOf(anchor({ range: null }), BODY, source())).toEqual([]);
  });

  it("places nothing for a range past the end of the body", () => {
    expect(segmentsOf(anchor({ range: { start: 900, end: 910 } }), BODY, source())).toEqual([]);
  });

  /**
   * **The reported document** (UI-099). A second paragraph of an outer list item,
   * after a nested sublist: the printer dropped the blank line before it, so the
   * two spellings rendered one newline differently. Every comment on the document
   * used to be refused for it — including this one, on the very first bullet,
   * whole lines before the construct that disagrees.
   *
   * UI-103 fixed the printer, so the editor's own text for this file is now the
   * file. The divergence is therefore supplied rather than printed — the
   * placement rule maps a server range onto **whatever text the editor is
   * showing**, and it is still handed a text that is not the file whenever the
   * file is not in the serializer's canonical shape (a loose list, an unpadded
   * table, a setext heading) or an out-of-band write has moved on.
   */
  it("draws an anchor that sits before the document's one respelt construct", () => {
    const raw =
      "- Outer bullet leads in.\n" +
      "  - Nested bullet one.\n" +
      "  - Nested bullet two.\n" +
      "\n" +
      "  A trailing paragraph of the outer item.\n" +
      "- Second outer bullet.\n";
    // What a pre-UI-103 editor held for it, and a fixed point of the printer:
    // the trailing paragraph merged into the last nested bullet.
    const traced = source(
      "- Outer bullet leads in.\n" +
        "  - Nested bullet one.\n" +
        "  - Nested bullet two.\n" +
        "    A trailing paragraph of the outer item.\n" +
        "- Second outer bullet.\n",
    );
    expect(traced.markdown).not.toBe(raw);

    const start = raw.indexOf("Outer bullet leads in.");
    const segments = segmentsOf(
      anchor({
        selector: { exact: "Outer bullet leads in.", prefix: "- ", suffix: "\n" },
        range: { start, end: start + "Outer bullet leads in.".length },
      }),
      raw,
      traced,
    );
    expect(segments).not.toEqual([]);
    expect(quoted(traced, segments).join("")).toContain("Outer bullet leads in.");
  });
});

describe("threads that hang off no text", () => {
  it("separates whole-document threads from orphaned ones", () => {
    const rows = [row(), row({ id: "th_whole" }), row({ id: "th_orphan" })];
    const anchors = [
      anchor(),
      anchor({ anchorId: "anc_3", threadId: "th_orphan", orphaned: true }),
    ];
    expect(detachedThreads(rows, anchors)).toEqual({
      wholeDocument: [rows[1]],
      orphaned: [rows[2]],
    });
  });

  it("lists an unplaceable thread, and never counts an orphan among them", () => {
    const traced = source();
    const placed = placeAnchors({
      rowsSettled: true,
      anchors: [
        anchor(),
        anchor({ anchorId: "anc_2", threadId: "th_2", orphaned: true, range: null }),
      ],
      rows: [row(), row({ id: "th_2" })],
      body: "A body that says something else entirely.\n",
      source: traced,
    });
    expect(unplacedThreads(placed).map((each) => each.id)).toEqual(["th_1"]);
  });
});

/**
 * PR #25 review, MINOR: a document's threads arrive as one paginated list while
 * its anchors do not, so a placement has to be able to describe a conversation
 * whose row is not in the answer — otherwise it disappears from the margin while
 * its highlight stays in the body, which SPEC.md §10 forbids in as many words.
 */
describe("an anchored conversation whose row has not arrived", () => {
  const placedAnchor = (overrides: Partial<ResolvedAnchor> = {}): AnchoredThread => {
    const [only] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor(overrides)],
      rows: [],
      body: BODY,
      source: source(),
    });
    return only as AnchoredThread;
  };

  it("describes itself from the anchor: which thread, what passage, what status", () => {
    const summary = summaryFromAnchor(placedAnchor({ threadStatus: "resolved" }), "doc_m");
    expect(summary.id).toBe("th_1");
    expect(summary.quote).toBe("6.1%");
    expect(summary.status).toBe("resolved");
    expect(summary.parent).toBe("doc_m");
  });

  /**
   * PR #25 re-review, MAJOR. This used to answer `unread: true` — the right
   * placement reached by asserting a fact an anchor does not carry. It says it
   * does not know instead, which stands the rule down just the same and keeps a
   * "new" badge off the line of a conversation nobody has evidence about.
   */
  it("does not know whether it holds anything unseen, and says so", () => {
    expect(summaryFromAnchor(placedAnchor({ threadStatus: "resolved" }), "doc_m").readState).toBe(
      "unknown",
    );
  });

  it("defers to the row the moment the list has one", () => {
    const withRow: AnchoredThread = {
      ...placedAnchor({ threadStatus: "resolved" }),
      row: row({ id: "th_1", status: "resolved", turnCount: 4, lastAuthor: "agent" }),
    };
    const summary = anchoredSummary(withRow, "doc_m");
    expect(summary.turnCount).toBe(4);
    expect(summary.lastAuthor).toBe("agent");
    expect(summary.readState).toBe("read");
  });
});

/**
 * UI-077: "no row yet" and "no row, ever" are different facts, and only the
 * second may be placed on — a placement is latched once, so a decision taken
 * against a list still in flight is permanent (`AnchoredThreads.tsx`).
 */
describe("whether the row list has answered", () => {
  const placedWith = (rows: DocRow[], rowsSettled: boolean): AnchoredThread => {
    const [only] = placeAnchors({
      rowsSettled,
      anchors: [anchor({ threadStatus: "resolved" })],
      rows,
      body: BODY,
      source: source(),
    });
    return only as AnchoredThread;
  };

  it("is unanswered while the list is in flight and the row is absent", () => {
    expect(placedWith([], false).rowKnown).toBe(false);
  });

  it("is answered once the list has come back without it — the paginated case", () => {
    expect(placedWith([], true).rowKnown).toBe(true);
  });

  it("is answered by the row itself, whatever the list is still doing", () => {
    // A row in hand is the answer; there is nothing further to wait for.
    expect(placedWith([row({ id: "th_1", status: "resolved" })], false).rowKnown).toBe(true);
  });
});

/**
 * UI-062, end to end over the whole round trip: a selection is quoted, the
 * server resolves the quote, and the answer comes back as a highlight. Asserted
 * here rather than over the offset helpers alone, because every helper was
 * already right — what was wrong was what the chain did with a body whose
 * spelling the editor does not reproduce.
 */
describe("a comment whose selection straddles inline markup", () => {
  /**
   * SPEC.md §6's exactness tier, rungs 1–2, as `GET /api/docs/{id}` applies it.
   * Restated rather than imported: `apps/ui` does not depend on the server, and
   * what this test needs from it is two lines of `indexOf`.
   */
  function resolve(body: string, selector: TextQuoteSelector): MdRange | null {
    const framed = body.indexOf(selector.prefix + selector.exact + selector.suffix);
    if (framed !== -1) {
      const start = framed + selector.prefix.length;
      return { start, end: start + selector.exact.length };
    }
    const first = body.indexOf(selector.exact);
    if (first === -1 || body.indexOf(selector.exact, first + 1) !== -1) return null;
    return { start: first, end: first + selector.exact.length };
  }

  /**
   * The whole flow, as the app runs it: the editor parses the file and the
   * selector is cut from what *it* would print (`selectorFromSelection`'s rule —
   * the quote is markdown, never the screen's text), the server resolves that
   * quote against the file, and the answer is placed back into the editor.
   */
  function comment(body: string, from: string, to: string): AnchoredThread {
    const traced = source(body);
    const live = traceOfBody(body);
    const start = live.markdown.indexOf(from);
    const end = live.markdown.indexOf(to) + to.length;
    const pm = mdRangeToPm(live.trace, { start, end });
    const captured = selectorFromSelection(
      live,
      { from: pm[0]?.from ?? 0, to: pm.at(-1)?.to ?? 0 },
      // The file, not the printing — what the app quotes and what the server
      // resolves against (UI-068).
      body,
    );
    if (!captured.ok) throw new Error(`the selection quoted nothing: ${captured.reason}`);
    const range = resolve(body, captured.selection.selector);
    const [placed] = placeAnchors({
      rowsSettled: true,
      anchors: [anchor({ range, orphaned: range === null })],
      rows: [row()],
      body,
      source: traced,
    });
    if (placed === undefined) throw new Error("no placement");
    return placed;
  }

  const BOLD = "Said **Moushmi Verma** on repositioning Fernando under Mesbah.\n";

  it("quotes the file's own spelling, asterisks and all", () => {
    const live = traceOfBody(BOLD);
    const start = live.markdown.indexOf("Moushmi");
    const pm = mdRangeToPm(live.trace, { start, end: live.markdown.indexOf("Mesbah") + 6 });
    const captured = selectorFromSelection(
      live,
      { from: pm[0]?.from ?? 0, to: pm.at(-1)?.to ?? 0 },
      BOLD,
    );
    expect(captured.ok ? captured.selection.selector.exact : null).toBe(
      "Moushmi Verma** on repositioning Fernando under Mesbah",
    );
  });

  it("highlights the selected words and not the markup, on a canonical file", () => {
    const placed = comment(BOLD, "Moushmi", "Mesbah");
    expect(quoted(source(BOLD), placed.placement.segments)).toEqual([
      "Moushmi Verma** on repositioning Fernando under Mesbah",
    ]);
    expect(isPlaced(placed)).toBe(true);
  });

  /**
   * The reported failure. Identical selection, identical quote — on a file
   * carrying the blank line every editor leaves after the frontmatter fence,
   * which the printer does not re-emit. Every offset in the file is one past
   * where the editor's own text would put it, and the thread used to end up
   * with no highlight and a card pinned to the top of the document.
   */
  it("still highlights it on a file the editor would print differently", () => {
    const body = `\n${BOLD}`;
    const placed = comment(body, "Moushmi", "Mesbah");
    expect(placed.orphaned).toBe(false);
    expect(isPlaced(placed)).toBe(true);
    expect(quoted(source(body), placed.placement.segments)).toEqual([
      "Moushmi Verma** on repositioning Fernando under Mesbah",
    ]);
  });

  it("keeps a selection wholly inside one text run working unchanged", () => {
    const body = "\nThe rate is 6.1% today.\n";
    const placed = comment(body, "rate", "today");
    expect(quoted(source(body), placed.placement.segments)).toEqual(["rate is 6.1% today"]);
  });

  it("covers no markup character the reader never saw", () => {
    const body = `\n${BOLD}`;
    const traced = source(body);
    const placed = comment(body, "Moushmi", "Mesbah");
    // A ProseMirror position exists only for content, so the highlight's own
    // span is the reader's text: the `**` inside the quote has no position and
    // therefore cannot be inside the decoration.
    expect(underHighlight(traced, placed.placement.segments)).toBe(
      "Moushmi Verma on repositioning Fernando under Mesbah",
    );
  });
});
