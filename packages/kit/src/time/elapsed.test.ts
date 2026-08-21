import { describe, expect, it } from "vitest";
import { humanizeElapsed } from "./elapsed.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("humanizeElapsed", () => {
  it.each([
    [0, "0m"],
    [MINUTE - 1, "0m"],
    [MINUTE, "1m"],
    [18 * MINUTE, "18m"],
    [2 * HOUR + 5 * MINUTE, "2h 05m"],
    [DAY + 3 * HOUR, "1d 03h"],
  ])("spells %sms as %s", (ms, expected) => {
    expect(humanizeElapsed(ms)).toBe(expected);
  });

  /**
   * UI-134's acceptance criterion, pinned as a **fact about the copy** rather
   * than as a layout fix.
   *
   * These two crossings are the widest jumps the function makes, and no digit
   * setting closes them: the string gains characters because it gains a unit.
   * The decision recorded in `elapsed.ts` is that the format stays, because both
   * callers render it into a box that absorbs the change — a sentence with
   * nothing aligned after it, or a span that truncates. A caller that ever
   * aligns something after this string reserves the slot itself.
   *
   * The test is here so that a later change to the format is a deliberate one:
   * it will fail, and whoever changes it has to re-check the two callers.
   */
  it.each([
    ["59m → 1h 00m", 59 * MINUTE, "59m", HOUR, "1h 00m"],
    ["23h 59m → 1d 00h", DAY - MINUTE, "23h 59m", DAY, "1d 00h"],
  ])("changes shape, not only width, at %s", (_label, beforeMs, before, afterMs, after) => {
    expect(humanizeElapsed(beforeMs)).toBe(before);
    expect(humanizeElapsed(afterMs)).toBe(after);
    // Different, and not always longer: `23h 59m` is seven characters and
    // `1d 00h` is six, so the row it sits in gets *narrower* at that crossing.
    // Either direction is movement, and neither is a digit-width problem.
    expect(after.length).not.toBe(before.length);
  });

  it("pads the minor unit so a crossing inside a shape is width-stable", () => {
    // `2h 05m` and `2h 15m` are the same length; with no padding they would not
    // be, and tabular figures could not have fixed it.
    expect(humanizeElapsed(2 * HOUR + 5 * MINUTE)).toHaveLength(
      humanizeElapsed(2 * HOUR + 15 * MINUTE).length,
    );
    expect(humanizeElapsed(DAY + 3 * HOUR)).toHaveLength(humanizeElapsed(DAY + 13 * HOUR).length);
  });
});
