import { describe, expect, it } from "vitest";
import { fitsFullSortLabel, shortSortLabel } from "./sortFit";

describe("shortSortLabel", () => {
  it.each([
    // The user's own wording for the degraded form (UI-038).
    ["last activity ↓", "last ↓"],
    ["last activity ↑", "last ↑"],
    // Already one word: nothing to shed, so nothing is shed.
    ["created ↓", "created ↓"],
    ["created ↑", "created ↑"],
    ["due ↑", "due ↑"],
    ["title ↑", "title ↑"],
    ["order ↑", "order ↑"],
    ["relevance", "relevance"],
  ])("degrades %j to %j", (label, expected) => {
    expect(shortSortLabel(label)).toBe(expected);
  });

  it("keeps the direction glyph of a label it has never seen", () => {
    // `viewDoc.ts` renders an unmapped sort verbatim, so this reaches here.
    expect(shortSortLabel("words per minute ↓")).toBe("words ↓");
    expect(shortSortLabel("sideways")).toBe("sideways");
  });

  it("survives labels with no word to keep", () => {
    expect(shortSortLabel("")).toBe("");
    expect(shortSortLabel("   ")).toBe("");
    expect(shortSortLabel("↓")).toBe("↓");
  });
});

describe("fitsFullSortLabel", () => {
  it("fits when the chips and the full label are inside the row", () => {
    expect(fitsFullSortLabel({ available: 300, required: 299 })).toBe(true);
  });

  it("fits exactly at the row's width", () => {
    expect(fitsFullSortLabel({ available: 300, required: 300 })).toBe(true);
  });

  it("does not fit one pixel past the row's width", () => {
    expect(fitsFullSortLabel({ available: 300, required: 301 })).toBe(false);
  });

  it("treats an unmeasured row as fitting rather than degrading blind", () => {
    expect(fitsFullSortLabel({ available: 0, required: 0 })).toBe(true);
    expect(fitsFullSortLabel({ available: 0, required: 299 })).toBe(true);
    expect(fitsFullSortLabel({ available: Number.NaN, required: 299 })).toBe(true);
  });

  /**
   * The property that makes the rule reversible: `required` is measured on a
   * copy of the row that always carries the full label, so it does not move
   * when the visible label degrades — a compact row that regains space is
   * therefore told it fits again.
   */
  it("answers the same way whichever form is currently on screen", () => {
    const wide = { available: 400, required: 304 };
    const narrow = { available: 240, required: 304 };
    expect(fitsFullSortLabel(wide)).toBe(true);
    expect(fitsFullSortLabel(narrow)).toBe(false);
    expect(fitsFullSortLabel(wide)).toBe(true);
  });
});
