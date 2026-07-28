import { NEEDS_REASONS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { reasonChip, reasonChips, REASON_CHIP_CLASSES } from "./reasons.js";

describe("the reason vocabulary", () => {
  it.each([
    ["unread-reply", "agent replied", REASON_CHIP_CLASSES.reply],
    ["form", "awaiting your answer", REASON_CHIP_CLASSES.form],
    // The prototype puts "due today" on the signal wash beside "awaiting your
    // answer" rather than inventing a fourth class for one label.
    ["due", "due today", REASON_CHIP_CLASSES.form],
    ["failed-job", "failed job", REASON_CHIP_CLASSES.neutral],
  ])("maps %s to %s on %s", (code, label, chipClass) => {
    expect(reasonChip(code)).toEqual({ code, label, chipClass });
  });

  it("chooses the stale label from the row's own tier", () => {
    expect(reasonChip("stale", "aging").label).toBe("getting stale");
    expect(reasonChip("stale", "stale").label).toBe("getting stale");
    expect(reasonChip("stale", "very-stale").label).toBe("review: archive or act");
    expect(reasonChip("stale", null).label).toBe("getting stale");
  });

  it("puts the stale chip on the sepia axis and nothing else", () => {
    expect(reasonChip("stale", "very-stale").chipClass).toBe(REASON_CHIP_CLASSES.stale);
  });

  it("has an entry for every reason code the contract declares", () => {
    for (const code of NEEDS_REASONS) {
      const chip = reasonChip(code);
      expect(chip.label).not.toBe(code);
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("renders an unknown code on a neutral chip rather than dropping it", () => {
    expect(reasonChip("todos/overdue")).toEqual({
      code: "todos/overdue",
      label: "todos/overdue",
      chipClass: REASON_CHIP_CLASSES.neutral,
    });
  });

  it("is not fooled by an inherited object key", () => {
    expect(reasonChip("toString").label).toBe("toString");
    expect(reasonChip("constructor").chipClass).toBe(REASON_CHIP_CLASSES.neutral);
  });
});

describe("reasonChips", () => {
  it("keeps the server's order and length", () => {
    const chips = reasonChips(["stale", "unread-reply", "x/unknown"], "very-stale");
    expect(chips.map((chip) => chip.code)).toEqual(["stale", "unread-reply", "x/unknown"]);
    expect(chips[0]?.label).toBe("review: archive or act");
  });

  it("is empty for a row with nothing to report", () => {
    expect(reasonChips([])).toEqual([]);
  });
});
