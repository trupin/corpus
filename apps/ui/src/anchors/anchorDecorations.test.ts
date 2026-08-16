/**
 * @vitest-environment jsdom
 */
import { Node as PmModelNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { corpusSchema, type PmNode } from "../editor/markdown/schema.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import {
  anchorDecorationPlugin,
  anchorState,
  innermostAt,
  setAnchorsTransaction,
  setProvisionalTransaction,
  type AnchorPlacement,
} from "./anchorDecorations.js";
import { mdRangeToPm, type PmRange } from "./offsetMap.js";

/**
 * The decoration layer, against a real ProseMirror state built from the real
 * schema. No editor view is mounted: what is under test is where the ranges go
 * and what survives a transaction, and both live in plugin state.
 */

const BODY = "The rate assumption is 6.1% today.\n\nA second paragraph follows it.\n";

const onActivate: { current: ((threadId: string) => void) | undefined } = { current: undefined };

function stateFor(markdown: string): EditorState {
  const schema = corpusSchema();
  const doc = PmModelNode.fromJSON(schema, parseMarkdown(markdown));
  return EditorState.create({ doc, plugins: [anchorDecorationPlugin({ onActivate })] });
}

function placement(overrides: Partial<AnchorPlacement> = {}): AnchorPlacement {
  return {
    anchorId: "anc_k4f7",
    threadId: "th_1",
    resolved: false,
    turnCount: 2,
    segments: [{ from: 5, to: 20 }],
    ...overrides,
  };
}

function withAnchors(state: EditorState, anchors: readonly AnchorPlacement[]): EditorState {
  return state.apply(setAnchorsTransaction(state, anchors));
}

/** The open composer's own range, or `null` to put it out. */
function withProvisional(state: EditorState, range: PmRange | null): EditorState {
  return state.apply(setProvisionalTransaction(state, range));
}

/** Every inline decoration's range, in order. */
function ranges(state: EditorState): { from: number; to: number }[] {
  const set = anchorState(state)?.set;
  if (set === undefined) return [];
  return set
    .find()
    .filter((decoration) => (decoration.spec as { widget?: unknown }).widget === undefined)
    .filter((decoration) => decoration.to > decoration.from)
    .map((decoration) => ({ from: decoration.from, to: decoration.to }));
}

function attributes(state: EditorState): Record<string, string>[] {
  return (anchorState(state)?.set.find() ?? [])
    .map(
      (decoration) =>
        (decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs,
    )
    .filter((attrs): attrs is Record<string, string> => attrs !== undefined);
}

beforeEach(() => {
  onActivate.current = undefined;
});

describe("server-resolved ranges", () => {
  it("become an inline decoration carrying the thread id", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    expect(ranges(state)).toEqual([{ from: 5, to: 20 }]);
    expect(attributes(state)[0]).toMatchObject({
      class: "anchor-hl",
      "data-thread": "th_1",
      "data-anchor": "anc_k4f7",
    });
  });

  it("read as resolved when the thread is", () => {
    const state = withAnchors(stateFor(BODY), [placement({ resolved: true })]);
    expect(attributes(state)[0]?.["class"]).toBe("anchor-hl resolved");
  });

  it("carry a pip widget at the range end, showing the turn count", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    // A widget occupies no range — `from === to` is what distinguishes it from
    // an inline decoration, and is also why it can never be part of the text.
    const widgets = (anchorState(state)?.set.find() ?? []).filter(
      (decoration) => decoration.from === decoration.to,
    );
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.from).toBe(20);
    const widget = widgets[0] as unknown as { type: { toDOM: () => HTMLElement } };
    const element = widget.type.toDOM();
    expect(element.className).toBe("anchor-pip");
    expect(element.textContent).toBe("2");
  });

  it("render one decoration per block for a multi-block anchor", () => {
    const state = withAnchors(stateFor(BODY), [
      placement({
        segments: [
          { from: 25, to: 35 },
          { from: 40, to: 50 },
        ],
      }),
    ]);
    expect(ranges(state)).toHaveLength(2);
  });

  it("render nothing at all for an orphan", () => {
    const state = withAnchors(stateFor(BODY), [placement({ segments: [] })]);
    expect(ranges(state)).toEqual([]);
    expect(anchorState(state)?.set.find()).toHaveLength(0);
  });
});

describe("living with edits", () => {
  const state = withAnchors(stateFor(BODY), [placement()]);

  it("keeps the highlight on the same words when text is inserted before it", () => {
    const next = state.apply(state.tr.insertText("Note: ", 1));
    expect(ranges(next)).toEqual([{ from: 11, to: 26 }]);
  });

  it("leaves it alone when text is inserted after it", () => {
    const next = state.apply(state.tr.insertText(" indeed", 30));
    expect(ranges(next)).toEqual([{ from: 5, to: 20 }]);
  });

  it("grows it when text is inserted inside it", () => {
    const next = state.apply(state.tr.insertText("very ", 10));
    expect(ranges(next)).toEqual([{ from: 5, to: 25 }]);
  });

  it("does not grow when text is typed against either edge", () => {
    const before = state.apply(state.tr.insertText("x", 5));
    expect(ranges(before)).toEqual([{ from: 6, to: 21 }]);
    const after = state.apply(state.tr.insertText("x", 20));
    expect(ranges(after)).toEqual([{ from: 5, to: 20 }]);
  });

  it("retains a deleted range as a hidden zero-width anchor rather than dropping it", () => {
    const next = state.apply(state.tr.delete(5, 20));
    expect(ranges(next)).toEqual([]);
    // Retained: the thread is still anchored as far as this client knows, and
    // only the server's report may orphan it.
    expect(anchorState(next)?.anchors).toHaveLength(1);
    expect(anchorState(next)?.anchors[0]?.segments).toEqual([{ from: 5, to: 5 }]);
  });

  it("brings a retyped range back to life without the thread ever leaving", () => {
    const deleted = state.apply(state.tr.delete(5, 20));
    const retyped = deleted.apply(deleted.tr.insertText("rate assumption", 5));
    expect(anchorState(retyped)?.anchors).toHaveLength(1);
    // The zero-width range does not re-grow on its own — the server's next
    // report is what re-attaches it — but the thread never disappeared.
    expect(ranges(retyped)).toEqual([]);
  });
});

/**
 * UI-112: the words an open composer is about, lit before the server has heard
 * of them — and the rule that makes that safe on an editable surface.
 */
describe("the provisional highlight", () => {
  const opened = withProvisional(stateFor(BODY), { from: 5, to: 20 });

  it("is painted with an anchor's own class, and carries no pip", () => {
    expect(ranges(opened)).toEqual([{ from: 5, to: 20 }]);
    // The same paint, because it is about to become one (§6). The flag is for
    // whoever needs to tell them apart; the appearance is not.
    expect(attributes(opened)[0]).toMatchObject({
      class: "anchor-hl",
      "data-provisional": "true",
    });
    // No conversation yet, so nothing to count the turns of.
    expect(
      anchorState(opened)
        ?.set.find()
        .filter((d) => d.from === d.to),
    ).toHaveLength(0);
    expect(anchorState(opened)?.anchors).toEqual([]);
  });

  it("reconciles with an edit around it — the common case while composing", () => {
    const above = opened.apply(opened.tr.insertText("Note: ", 1));
    expect(ranges(above)).toEqual([{ from: 11, to: 26 }]);
    expect(above.doc.textBetween(11, 26)).toBe(opened.doc.textBetween(5, 20));

    const below = opened.apply(opened.tr.insertText(" indeed", 30));
    expect(ranges(below)).toEqual([{ from: 5, to: 20 }]);
  });

  /**
   * The asymmetry with an anchor, which retains a collapsed range and hides it:
   * that retention exists because a conversation hangs off the anchor and only
   * the server may orphan it. Nothing hangs off this one, and a zero-width mark
   * claiming the selection survived its own deletion would be a lie the surface
   * has no way to correct.
   */
  it("yields to an edit through it, where an anchor would be retained", () => {
    const typedOver = opened.apply(opened.tr.delete(5, 20));
    expect(anchorState(typedOver)?.provisional).toBeNull();
    expect(anchorState(typedOver)?.set.find()).toHaveLength(0);

    const anchored = withAnchors(stateFor(BODY), [placement()]);
    const sameEdit = anchored.apply(anchored.tr.delete(5, 20));
    expect(anchorState(sameEdit)?.anchors[0]?.segments).toEqual([{ from: 5, to: 5 }]);
  });

  it("goes out when the host puts it out, leaving the anchors alone", () => {
    const withBoth = withProvisional(withAnchors(stateFor(BODY), [placement()]), {
      from: 25,
      to: 30,
    });
    expect(ranges(withBoth)).toHaveLength(2);

    const closed = withProvisional(withBoth, null);
    expect(anchorState(closed)?.provisional).toBeNull();
    expect(ranges(closed)).toEqual([{ from: 5, to: 20 }]);
  });

  it("survives a report about the anchors, which says nothing about it", () => {
    const reported = withAnchors(opened, [placement({ segments: [{ from: 25, to: 30 }] })]);
    expect(anchorState(reported)?.provisional).toEqual({ from: 5, to: 20 });
    expect(ranges(reported)).toContainEqual({ from: 5, to: 20 });
  });
});

describe("the server's report", () => {
  it("overrides whatever the local mapping had made of the range", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    const typed = state.apply(state.tr.insertText("Note: ", 1));
    expect(ranges(typed)).toEqual([{ from: 11, to: 26 }]);

    const reported = withAnchors(typed, [placement({ segments: [{ from: 1, to: 4 }] })]);
    expect(ranges(reported)).toEqual([{ from: 1, to: 4 }]);
  });

  it("removes a decoration for an anchor it no longer lists", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    const emptied = withAnchors(state, []);
    expect(emptied.doc.eq(state.doc)).toBe(true);
    expect(anchorState(emptied)?.set.find()).toHaveLength(0);
  });
});

describe("clicking a highlight", () => {
  it("reports the innermost anchor and does not consume the click", () => {
    const outer = placement({ threadId: "th_outer", segments: [{ from: 5, to: 30 }] });
    const inner = placement({
      threadId: "th_inner",
      anchorId: "anc_2",
      segments: [{ from: 10, to: 15 }],
    });
    expect(innermostAt([outer, inner], 12)?.threadId).toBe("th_inner");
    expect(innermostAt([outer, inner], 25)?.threadId).toBe("th_outer");
    expect(innermostAt([outer, inner], 100)).toBeNull();
  });

  it("hands the thread id to the host", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    const seen = vi.fn();
    onActivate.current = seen;
    const plugin = state.plugins.find((candidate) => candidate.props.handleClick !== undefined);
    plugin?.props.handleClick?.call(plugin, { state } as never, 10, new MouseEvent("click"));
    expect(seen).toHaveBeenCalledWith("th_1");
  });
});

/* ── TEST-89: the byte-level proof ──────────────────────────────────── */

describe("the never-marks guarantee", () => {
  it("serializes byte-identically with every highlight rendered", () => {
    const plain = stateFor(BODY);
    const highlighted = withAnchors(plain, [
      placement(),
      placement({
        threadId: "th_2",
        anchorId: "anc_2",
        resolved: true,
        segments: [{ from: 40, to: 55 }],
      }),
    ]);
    expect(anchorState(highlighted)?.set.find().length).toBeGreaterThan(0);
    expect(serializeDoc(highlighted.doc.toJSON() as PmNode)).toBe(
      serializeDoc(plain.doc.toJSON() as PmNode),
    );
    expect(serializeDoc(highlighted.doc.toJSON() as PmNode)).toBe(BODY);
  });

  it("leaves no trace of a highlight in the document JSON", () => {
    const state = withAnchors(stateFor(BODY), [placement()]);
    const json = JSON.stringify(state.doc.toJSON());
    expect(json).not.toContain("anchor-hl");
    expect(json).not.toContain("th_1");
    expect(json).not.toContain("anc_k4f7");
  });
});

/* ── The two halves together ────────────────────────────────────────── */

describe("an anchor placed through the offset map", () => {
  it("lands on the words the server's character range names", () => {
    const doc = parseMarkdown(BODY);
    const traced = serializeDoc(doc, { trace: true });
    const start = traced.markdown.indexOf("6.1%");
    const segments = mdRangeToPm(traced.trace, { start, end: start + 4 });
    const state = withAnchors(stateFor(BODY), [placement({ segments })]);
    const decoration = ranges(state)[0];
    expect(decoration).toBeDefined();
    expect(state.doc.textBetween(decoration?.from ?? 0, decoration?.to ?? 0)).toBe("6.1%");
  });
});
