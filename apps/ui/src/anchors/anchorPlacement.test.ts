import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import { threadRowFixture } from "../testing/readerFixture.js";
import { detachedThreads, offsetsComparable, placeAnchors } from "./anchorPlacement.js";
import type { DocumentTrace } from "./traceCache.js";

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

describe("placing an anchor", () => {
  it("puts the highlight where the server's character range says", () => {
    const [placed] = placeAnchors({
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
      anchors: [anchor({ threadStatus: "resolved" })],
      rows: [row({ status: "resolved" })],
      body: BODY,
      source: source(),
    });
    expect(placed?.placement.resolved).toBe(true);
  });

  it("gives an orphan no segments at all", () => {
    const [placed] = placeAnchors({
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

    it("draws nothing rather than a highlight in the wrong paragraph", () => {
      const [placed] = placeAnchors({
        anchors: [anchor({ range: { start: 0, end: 5 } })],
        rows: [row()],
        body: raw,
        source: source(raw),
      });
      expect(placed?.placement.segments).toEqual([]);
      expect(placed?.orphaned).toBe(false);
    });
  });

  it("refuses a same-length respelling that redistributes characters across lines", () => {
    // Same total, same line count, different line lengths: an offset in the
    // first line is a different character in the two spellings.
    expect(offsetsComparable("abcd\nef\n", "ab\ncdef\n")).toBe(false);
  });

  it("draws no highlight rather than a wrong one", () => {
    const raw = "Title\n=====\n\nThe rate is 6.1% today.\n";
    const [placed] = placeAnchors({
      anchors: [anchor({ range: { start: 24, end: 28 } })],
      rows: [row()],
      body: raw,
      source: source(raw),
    });
    expect(placed?.placement.segments).toEqual([]);
    // …and it is not called an orphan, because it is not one.
    expect(placed?.orphaned).toBe(false);
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
});
