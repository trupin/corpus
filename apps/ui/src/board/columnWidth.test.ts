import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  READING_WIDTH_CEILING,
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

describe("renderedWidth", () => {
  it("reproduces the shipped constants for a column with no chosen width", () => {
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH, false, WIDE_VIEWPORT)).toBe(336);
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH, true, WIDE_VIEWPORT)).toBe(560);
  });

  it("widens relative to the chosen base, never to a fixed 560", () => {
    // The specific regression sprint-016 TEST-450 names: a narrow column that
    // jumps to 560.
    expect(renderedWidth(260, true, WIDE_VIEWPORT)).toBeGreaterThan(260);
    expect(renderedWidth(260, true, WIDE_VIEWPORT)).toBeLessThan(READING_WIDTH_CEILING);
    // 300 × (560 / 336) — the widening the e2e suite measures in the browser.
    expect(renderedWidth(300, true, WIDE_VIEWPORT)).toBe(500);
  });

  it("never widens past the content measure (UI-023)", () => {
    // The reported bug: a column dragged wide opened a reader that was mostly
    // gutter, because the ratio was clamped only by MAX_COLUMN_WIDTH.
    expect(renderedWidth(800, true, WIDE_VIEWPORT)).toBe(READING_WIDTH_CEILING);
    expect(renderedWidth(MAX_COLUMN_WIDTH, true, WIDE_VIEWPORT)).toBe(READING_WIDTH_CEILING);
    // A base already at the measure opens there rather than past it.
    expect(renderedWidth(READING_WIDTH_CEILING, true, WIDE_VIEWPORT)).toBe(READING_WIDTH_CEILING);
    // The last base that still widens on its own terms, and the first that does not.
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH - 1, true, WIDE_VIEWPORT)).toBeLessThan(
      READING_WIDTH_CEILING,
    );
    expect(renderedWidth(DEFAULT_COLUMN_WIDTH + 1, true, WIDE_VIEWPORT)).toBe(
      READING_WIDTH_CEILING,
    );
  });

  it("leaves the base width alone when the reader closes", () => {
    // The ceiling is a property of *reading*, not of the column: a column the
    // user dragged to 900 is still 900 wide with its list showing.
    expect(renderedWidth(900, false, WIDE_VIEWPORT)).toBe(900);
    expect(renderedWidth(MAX_COLUMN_WIDTH, false, WIDE_VIEWPORT)).toBe(MAX_COLUMN_WIDTH);
  });

  it("takes the narrower of the ceiling and the viewport clamp", () => {
    // A viewport too narrow for the measure wins over it…
    expect(renderedWidth(400, true, 500)).toBe(500 - 48);
    // …and a viewport with room to spare leaves the ceiling in charge.
    expect(renderedWidth(400, true, WIDE_VIEWPORT)).toBe(READING_WIDTH_CEILING);
    expect(renderedWidth(900, true, 288)).toBe(MIN_COLUMN_WIDTH);
  });
});
