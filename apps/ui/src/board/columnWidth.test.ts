import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
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
    // jumps to 560, or a wide one that shrinks.
    expect(renderedWidth(260, true, WIDE_VIEWPORT)).toBeGreaterThan(260);
    expect(renderedWidth(260, true, WIDE_VIEWPORT)).toBeLessThan(560);
    expect(renderedWidth(800, true, WIDE_VIEWPORT)).toBeGreaterThan(800);
  });

  it("still clamps the widened width", () => {
    expect(renderedWidth(MAX_COLUMN_WIDTH, true, WIDE_VIEWPORT)).toBe(MAX_COLUMN_WIDTH);
  });
});
