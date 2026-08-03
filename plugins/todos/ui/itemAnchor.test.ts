import type { ResolvedAnchor } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { itemSelector, SELECTOR_CONTEXT, threadForItem } from "./itemAnchor.js";

/**
 * PLUGINS-009's two questions about an item, both answered from the parent's
 * body: "what would a comment on it quote?" and "does it already have one?".
 */

const BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [ ] Book the passport appointment (due: 2026-08-01)",
  "- [ ] Call the plumber",
  "- [x] Send the signed form",
  "",
].join("\n");

const anchor = (overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor => ({
  anchorId: "anc_1",
  threadId: "th_1",
  threadStatus: "open",
  selector: { exact: "Call the plumber", prefix: "", suffix: "" },
  range: { start: 0, end: 16 },
  orphaned: false,
  ...overrides,
});

describe("itemSelector", () => {
  it("quotes the item's words, and frames them with the real body around them", () => {
    const selector = itemSelector(BODY, 1, "Call the plumber");
    expect(selector).not.toBeNull();
    expect(selector?.exact).toBe("Call the plumber");
    // The frame is the body's own text, markdown included — which is what makes
    // it byte-identical to a selection made in the reader.
    expect(selector?.prefix.endsWith("(due: 2026-08-01)\n- [ ] ")).toBe(true);
    expect(selector?.suffix.startsWith("\n- [x] Send the signed form")).toBe(true);
    expect(selector?.prefix.length).toBe(SELECTOR_CONTEXT);
  });

  it("carries an empty frame at a document boundary rather than inventing one", () => {
    const selector = itemSelector("- [ ] alone\n", 0, "alone");
    expect(selector).toEqual({ exact: "alone", prefix: "- [ ] ", suffix: "\n" });
  });

  it("never quotes the checkbox syntax or the due marker", () => {
    const selector = itemSelector(BODY, 0, "Book the passport appointment");
    expect(selector?.exact).toBe("Book the passport appointment");
    expect(selector?.exact).not.toContain("[ ]");
    expect(selector?.exact).not.toContain("due:");
  });

  /**
   * The guard sprint-023 OC4 is really about. The aggregate and the document
   * are two reads, and an item deleted between them shifts every index after
   * it: anchoring to "whatever is at index 1 now" is a wrong anchor, which is
   * worse than none because nothing about it looks wrong afterwards.
   */
  it("refuses when the item at that index is no longer the one the user saw", () => {
    expect(itemSelector(BODY, 1, "Renew the car insurance")).toBeNull();
  });

  it("refuses a body that has no such item at all", () => {
    expect(itemSelector(BODY, 9, "Call the plumber")).toBeNull();
    // A not-yet-migrated document: its items are in frontmatter, its body has
    // no task lines, and there is nothing in it to anchor to.
    expect(itemSelector("## Notes\n\nNo list here.\n", 0, "Call the plumber")).toBeNull();
  });

  /**
   * Two identical items, which the column shows as two identical rows. Both
   * selectors quote the same words; only the frames tell them apart, and that
   * is the entire reason the frames are read from the body.
   */
  it("distinguishes duplicate items by their frames", () => {
    const body = [
      "- [ ] Call the plumber",
      "- [ ] Chase the invoice",
      "- [ ] Call the plumber",
    ].join("\n");
    const first = itemSelector(body, 0, "Call the plumber");
    const third = itemSelector(body, 2, "Call the plumber");
    expect(first?.exact).toBe(third?.exact);
    expect(first?.prefix).not.toBe(third?.prefix);
    expect(third?.prefix).toContain("Chase the invoice");
  });
});

describe("threadForItem", () => {
  it("finds the thread whose quote is the item", () => {
    expect(threadForItem([anchor()], "Call the plumber")?.threadId).toBe("th_1");
  });

  it("ignores an orphaned anchor — it no longer points at this document", () => {
    expect(threadForItem([anchor({ orphaned: true, range: null })], "Call the plumber")).toBeNull();
  });

  it("ignores a thread that quotes only part of the item", () => {
    expect(
      threadForItem(
        [anchor({ selector: { exact: "plumber", prefix: "", suffix: "" } })],
        "Call the plumber",
      ),
    ).toBeNull();
  });

  it("answers null for an item with no anchors at all", () => {
    expect(threadForItem([], "Call the plumber")).toBeNull();
  });

  it("takes the first of two anchors on the same words", () => {
    const second = anchor({ anchorId: "anc_2", threadId: "th_2" });
    expect(threadForItem([anchor(), second], "Call the plumber")?.threadId).toBe("th_1");
  });
});
