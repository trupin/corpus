import { describe, expect, it } from "vitest";
import type { TodoItem } from "../items.js";
import { itemOpenRequest, lineText } from "./reveal.js";

const item = (text: string, done = false, due?: string): TodoItem => ({
  text,
  done,
  ...(due === undefined ? {} : { due }),
});

describe("lineText", () => {
  it("is the item's text when it carries no deadline", () => {
    expect(lineText(item("Call the plumber"))).toBe("Call the plumber");
  });

  it("carries the inline due marker, because the rendered line does", () => {
    expect(lineText(item("Pay the bill", false, "2026-08-01"))).toBe(
      "Pay the bill (due: 2026-08-01)",
    );
  });
});

describe("itemOpenRequest", () => {
  it("names the clicked item and both of its neighbours", () => {
    const items = [item("Book the flights"), item("Call the plumber"), item("Send the form")];
    expect(itemOpenRequest("doc_week", items, 1)).toEqual({
      docId: "doc_week",
      reveal: {
        kind: "item",
        exact: "Call the plumber",
        prefix: "Book the flights",
        suffix: "Send the form",
      },
    });
  });

  it("frames the first item with what follows it and the last with what precedes it", () => {
    const items = [item("First"), item("Middle"), item("Last")];
    expect(itemOpenRequest("doc_week", items, 0).reveal).toEqual({
      kind: "item",
      exact: "First",
      suffix: "Middle",
    });
    expect(itemOpenRequest("doc_week", items, 2).reveal).toEqual({
      kind: "item",
      exact: "Last",
      prefix: "Middle",
    });
  });

  it("frames a lone item with nothing at all, and still reveals it", () => {
    expect(itemOpenRequest("doc_week", [item("Only one")], 0)).toEqual({
      docId: "doc_week",
      reveal: { kind: "item", exact: "Only one" },
    });
  });

  /**
   * sprint-023 OC4, in the shape a todo list actually produces it: `exact`
   * alone would send every one of these to the first line. The frames are what
   * make the three requests different, and each one encloses exactly one
   * occurrence — which is what the reader's `chooseOccurrence` resolves on.
   */
  it("distinguishes three identical items by their neighbours", () => {
    const items = [
      item("Call the plumber"),
      item("Book the passport appointment"),
      item("Call the plumber"),
      item("Rinse the filters"),
      item("Call the plumber"),
    ];
    expect(itemOpenRequest("doc_week", items, 0).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      suffix: "Book the passport appointment",
    });
    expect(itemOpenRequest("doc_week", items, 2).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Book the passport appointment",
      suffix: "Rinse the filters",
    });
    expect(itemOpenRequest("doc_week", items, 4).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Rinse the filters",
    });
  });

  /**
   * The frame is the line the *reader* renders above the target, and a checked
   * item is rendered. Quoting the previous **open** item instead would name a
   * line that is not adjacent on screen, and the frame would match nothing.
   */
  it("frames with a checked neighbour, because the reader renders it", () => {
    const items = [item("Send the form", true), item("Call the plumber"), item("Rinse", true)];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Send the form",
      suffix: "Rinse",
    });
  });

  /**
   * The due marker is part of the rendered line, so a frame has to carry it —
   * the text before the target ends with `(due: …)`, not with the item's words.
   * The target's own quote leaves it out: it is bookkeeping, and a deadline
   * edited between the click and the open must not cost the reveal.
   */
  it("quotes a deadline in the frame and never in the target", () => {
    const items = [
      item("Book the passport appointment", false, "2026-08-01"),
      item("Call the plumber", false, "2026-08-09"),
      item("Send the form", false, "2026-08-10"),
    ];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Book the passport appointment (due: 2026-08-01)",
      suffix: "Send the form",
    });
  });

  it("trims what it quotes, so a stray indent is not part of the frame", () => {
    const items = [item("  padded  "), item("  target  "), item("  trailing  ")];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "target",
      prefix: "padded",
      suffix: "trailing",
    });
  });

  /**
   * A reveal that cannot name its target must not be sent: the reader would
   * search for nothing and the navigation entry would carry a dead instruction.
   * An ordinary open is the honest fallback — the document still opens.
   */
  it("sends a plain open when the position names no item", () => {
    const items = [item("Only one")];
    expect(itemOpenRequest("doc_week", items, 3)).toEqual({ docId: "doc_week" });
    expect(itemOpenRequest("doc_week", items, -1)).toEqual({ docId: "doc_week" });
    expect(itemOpenRequest("doc_week", [], 0)).toEqual({ docId: "doc_week" });
  });

  it("sends a plain open for an item with nothing quotable in it", () => {
    expect(itemOpenRequest("doc_week", [item("   ")], 0)).toEqual({ docId: "doc_week" });
  });

  it("drops a frame that is itself blank rather than quoting emptiness", () => {
    const items = [item("   "), item("Call the plumber"), item(" ")];
    expect(itemOpenRequest("doc_week", items, 1)).toEqual({
      docId: "doc_week",
      reveal: { kind: "item", exact: "Call the plumber" },
    });
  });
});
