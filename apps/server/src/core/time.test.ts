import { describe, expect, it, vi } from "vitest";
import {
  CANONICAL_INSTANT,
  formatInstant,
  instantToEpochMs,
  nextSecond,
  normalizeCalendarDate,
  normalizeInstant,
  nowIso,
} from "./time.js";

describe("nowIso", () => {
  it("emits UTC at second precision", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:07:12.987Z"));
    expect(nowIso()).toBe("2026-07-19T10:07:12Z");
    vi.useRealTimers();
  });

  it("always matches the canonical shape", () => {
    expect(nowIso()).toMatch(CANONICAL_INSTANT);
  });
});

describe("formatInstant", () => {
  it("truncates sub-second precision rather than rounding", () => {
    expect(formatInstant(Date.parse("2026-07-19T10:07:12.999Z"))).toBe("2026-07-19T10:07:12Z");
  });
});

describe("normalizeInstant", () => {
  it.each([
    ["2026-07-19T10:05:00Z", "2026-07-19T10:05:00Z"],
    ["2026-07-19T10:05:00.123Z", "2026-07-19T10:05:00Z"],
    ["2026-07-19t10:05:00z", "2026-07-19T10:05:00Z"],
    ["2026-07-19 10:05:00Z", "2026-07-19T10:05:00Z"],
    ["2026-07-19T12:05:00+02:00", "2026-07-19T10:05:00Z"],
    ["2026-07-19T12:05:00+0200", "2026-07-19T10:05:00Z"],
    ["2026-07-19T10:05Z", "2026-07-19T10:05:00Z"],
    ["2026-07-19", "2026-07-19T00:00:00Z"],
    ["  2026-07-19T10:05:00Z  ", "2026-07-19T10:05:00Z"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeInstant(input)).toBe(expected);
  });

  it.each([
    ["not a date"],
    ["2026-13-01T00:00:00Z"],
    ["2026-02-30T00:00:00Z"],
    ["2026-07-19T10:05:00"],
    [""],
  ])("rejects %s", (input) => {
    expect(normalizeInstant(input)).toBeNull();
  });
});

describe("normalizeCalendarDate", () => {
  it("accepts a bare calendar date", () => {
    expect(normalizeCalendarDate(" 2026-08-01 ")).toBe("2026-08-01");
  });

  it.each([["2026-08-01T00:00:00Z"], ["2026-13-01"], ["2026-02-30"], ["August"]])(
    "rejects %s",
    (input) => {
      expect(normalizeCalendarDate(input)).toBeNull();
    },
  );
});

describe("instantToEpochMs", () => {
  it("returns epoch milliseconds for a valid instant", () => {
    expect(instantToEpochMs("2026-07-19T10:05:00Z")).toBe(Date.parse("2026-07-19T10:05:00Z"));
  });

  it("returns null for a non-instant", () => {
    expect(instantToEpochMs("nope")).toBeNull();
  });
});

describe("nextSecond", () => {
  it("advances by exactly one second", () => {
    expect(nextSecond("2026-07-19T10:07:12Z")).toBe("2026-07-19T10:07:13Z");
  });

  it("crosses a minute boundary", () => {
    expect(nextSecond("2026-07-19T10:07:59Z")).toBe("2026-07-19T10:08:00Z");
  });

  it("throws on a value that is not an instant", () => {
    expect(() => nextSecond("nope")).toThrow(TypeError);
  });
});
