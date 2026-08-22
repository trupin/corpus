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

/**
 * SPEC.md §10: "a thread holding **more than one** unanswered form says how many
 * are still open". The threshold is the behaviour — one form reads exactly as it
 * always has — so every case around it is pinned, not just the plural one.
 */
describe("how many unanswered forms are still open", () => {
  it("says nothing extra at one, which is the ordinary case", () => {
    expect(reasonChip("form", null, 1).label).toBe("awaiting your answer");
  });

  it("says how many above one", () => {
    expect(reasonChip("form", null, 2).label).toBe("2 awaiting your answer");
    expect(reasonChip("form", null, 3).label).toBe("3 awaiting your answer");
    expect(reasonChip("form", null, 11).label).toBe("11 awaiting your answer");
  });

  it("keeps the signal chip whatever the count", () => {
    expect(reasonChip("form", null, 4).chipClass).toBe(REASON_CHIP_CLASSES.form);
  });

  /*
   * `0` with a `form` reason cannot come off the wire — the contract publishes
   * `unansweredForms > 0` **iff** `attention` contains `form` — but the default
   * is `0`, and a caller that has only a code must still get a chip rather than
   * "0 awaiting your answer".
   */
  it("falls back to the bare wording when no count was supplied", () => {
    expect(reasonChip("form").label).toBe("awaiting your answer");
    expect(reasonChip("form", null, 0).label).toBe("awaiting your answer");
  });

  it("is the form reason's alone — no other code borrows the number", () => {
    expect(reasonChip("due", null, 3).label).toBe("due today");
    expect(reasonChip("unread-reply", null, 3).label).toBe("agent replied");
    expect(reasonChip("failed-job", null, 3).label).toBe("failed job");
    expect(reasonChip("stale", "very-stale", 3).label).toBe("review: archive or act");
    expect(reasonChip("todos/overdue", null, 3).label).toBe("todos/overdue");
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

  it("carries the count through to the one chip that reads it", () => {
    const chips = reasonChips(["unread-reply", "form"], null, 2);
    expect(chips.map((chip) => chip.label)).toEqual(["agent replied", "2 awaiting your answer"]);
  });
});
