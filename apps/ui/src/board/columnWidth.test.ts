import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  READING_WIDTH_CEILING,
  readingFloor,
  clampColumnWidth,
  readStoredWidth,
  renderedWidth,
} from "./columnWidth";

/**
 * The stored width is an `extra` frontmatter key the server never interprets,
 * so this module is the only place a hand-edited or agent-written value can be
 * caught (sprint-016 TEST-452).
 */

const WIDE_VIEWPORT = 3000;

describe("readStoredWidth", () => {
  it.each([
    [undefined, null],
    [{}, null],
    [{ width: 420 }, 420],
    [{ width: 420.5 }, 420.5],
    [{ width: "420" }, null],
    [{ width: "wide" }, null],
    [{ width: -10 }, null],
    [{ width: 0 }, null],
    [{ width: Number.NaN }, null],
    [{ width: Number.POSITIVE_INFINITY }, null],
    [{ width: null }, null],
    [{ width: { px: 420 } }, null],
    [{ width: [420] }, null],
  ])("reads %j as %s", (extra, expected) => {
    expect(readStoredWidth(extra as Readonly<Record<string, unknown>> | undefined)).toBe(expected);
  });

  it("ignores the other extra keys entirely", () => {
    expect(readStoredWidth({ items: [{ text: "a" }], width: 400 })).toBe(400);
  });
});

describe("clampColumnWidth", () => {
  it("keeps a sane width unchanged, rounded", () => {
    expect(clampColumnWidth(420.4, WIDE_VIEWPORT)).toBe(420);
  });

  it("holds both extremes", () => {
    expect(clampColumnWidth(10, WIDE_VIEWPORT)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(99_999, WIDE_VIEWPORT)).toBe(MAX_COLUMN_WIDTH);
  });

  it("recomputes the ceiling from the live viewport, never from a stored one", () => {
    // A width chosen on a wide display must not survive onto a laptop as a
    // column that fills the window.
    expect(clampColumnWidth(900, 700)).toBe(700 - 48);
    // …and a viewport narrower than the minimum still yields a usable column.
    expect(clampColumnWidth(900, 200)).toBe(MIN_COLUMN_WIDTH);
  });

  it("answers the default for a width that is not a number at all", () => {
    expect(clampColumnWidth(Number.NaN, WIDE_VIEWPORT)).toBe(DEFAULT_COLUMN_WIDTH);
  });
});

describe("readingFloor — the width a reader needs, as a floor and never a cap", () => {
  it("is the widened base, bounded by the content measure", () => {
    // Unchanged arithmetic: what changed is that this is now a floor the column
    // may be raised to, not a ceiling imposed on the width the user chose.
    expect(readingFloor(DEFAULT_COLUMN_WIDTH, WIDE_VIEWPORT)).toBe(560);
    expect(readingFloor(300, WIDE_VIEWPORT)).toBe(500);
    expect(readingFloor(800, WIDE_VIEWPORT)).toBe(READING_WIDTH_CEILING);
  });
});

describe("renderedWidth — up automatically, down never (UI-113)", () => {
  it("is the base when nothing has grown it", () => {
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH, 0, WIDE_VIEWPORT)).toBe(336);
    expect(renderedWidth(800, 0, WIDE_VIEWPORT)).toBe(800);
  });

  it("never narrows a column that is already wider than the floor", () => {
    // **The reported defect.** A column dragged to 800 opened at 560 — the app
    // taking 240px off a width the user had chosen, because the reading measure
    // was applied as a cap. Two screenshots and: "I don't want the size to
    // shrink, ever."
    expect(renderedWidth(800, READING_WIDTH_CEILING, WIDE_VIEWPORT)).toBe(800);
    expect(renderedWidth(MAX_COLUMN_WIDTH, READING_WIDTH_CEILING, WIDE_VIEWPORT)).toBe(
      MAX_COLUMN_WIDTH,
    );
  });

  it("grows a column too narrow to show its content", () => {
    // The one automatic change kept: "it can resize up automatically but not
    // down."
    expect(
      renderedWidth(
        DEFAULT_COLUMN_WIDTH,
        readingFloor(DEFAULT_COLUMN_WIDTH, WIDE_VIEWPORT),
        WIDE_VIEWPORT,
      ),
    ).toBe(560);
    expect(renderedWidth(260, readingFloor(260, WIDE_VIEWPORT), WIDE_VIEWPORT)).toBeGreaterThan(
      260,
    );
  });

  it("keeps a grown column grown, because closing must not shrink it either", () => {
    // The floor outlives the reader. Snapping back to the base on close would
    // be the app resizing the column downward on its own, which is the whole
    // complaint — "went back to what you set" is still the app moving it.
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH, 560, WIDE_VIEWPORT)).toBe(560);
  });

  it("still obeys the viewport, which is a constraint rather than an opinion", () => {
    const narrow = 400;
    expect(renderedWidth(MAX_COLUMN_WIDTH, 0, narrow)).toBeLessThanOrEqual(narrow);
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, narrow)).toBeLessThanOrEqual(
      narrow,
    );
  });
});
