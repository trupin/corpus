import { STALE_TIERS, type StaleTier } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { docRowFixture } from "../testing/docRow.js";
import {
  ageAnchor,
  ageLabel,
  hasStaleActions,
  humanizeAge,
  stalenessClass,
  stalenessLevel,
  UNKNOWN_AGE_LABEL,
} from "./staleness.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-27T12:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

describe("stalenessLevel", () => {
  it.each([
    [null, 0],
    [undefined, 0],
    ["aging", 1],
    ["stale", 2],
    ["very-stale", 3],
  ] as const)("maps the server tier %s to level %i", (tier, level) => {
    expect(stalenessLevel(tier)).toBe(level);
  });

  it("covers every tier the contract declares", () => {
    for (const tier of STALE_TIERS) expect(stalenessLevel(tier)).toBeGreaterThan(0);
  });

  it("degrades an unrecognised tier to fresh rather than to ancient", () => {
    expect(stalenessLevel("epochal" as StaleTier)).toBe(0);
  });
});

describe("the ladder's rendering helpers", () => {
  it.each([
    [0, ""],
    [1, "age-1"],
    [2, "age-2"],
    [3, "age-3"],
  ] as const)("level %i takes the class %s", (level, className) => {
    expect(stalenessClass(level)).toBe(className);
  });

  it.each([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
  ] as const)("level %i grows quick actions: %s", (level, expected) => {
    expect(hasStaleActions(level)).toBe(expected);
  });
});

describe("ageAnchor", () => {
  it("runs from max(updated, reviewed)", () => {
    const anchor = ageAnchor(
      docRowFixture({ updated: daysAgo(200), reviewed: daysAgo(3), created: daysAgo(400) }),
    );
    expect(anchor).toBe(Date.parse(daysAgo(3)));
  });

  it("takes `updated` when it is the newer of the two", () => {
    const anchor = ageAnchor(docRowFixture({ updated: daysAgo(3), reviewed: daysAgo(200) }));
    expect(anchor).toBe(Date.parse(daysAgo(3)));
  });

  it("absorbs a `reviewed` in the future without producing a negative age", () => {
    const future = new Date(NOW.getTime() + 5 * DAY).toISOString();
    const row = docRowFixture({ updated: daysAgo(90), reviewed: future });
    expect(ageAnchor(row)).toBe(Date.parse(future));
    expect(humanizeAge(NOW.getTime() - (ageAnchor(row) ?? 0))).toBe("just now");
  });

  it("falls back to `created` only when both age fields are absent", () => {
    const row = docRowFixture({ updated: null, reviewed: null, created: daysAgo(40) });
    expect(ageAnchor(row)).toBe(Date.parse(daysAgo(40)));
  });

  it("is undefined when the row carries no timestamp at all", () => {
    expect(
      ageAnchor(docRowFixture({ created: null, updated: null, reviewed: null })),
    ).toBeUndefined();
  });

  it("ignores an unparseable timestamp rather than producing NaN", () => {
    const row = docRowFixture({ updated: "not-a-date", reviewed: null, created: daysAgo(10) });
    expect(ageAnchor(row)).toBe(Date.parse(daysAgo(10)));
  });
});

describe("humanizeAge", () => {
  it.each([
    [0, "just now"],
    [30 * 60 * 1000, "just now"],
    [3 * 60 * 60 * 1000, "3h"],
    [3 * DAY, "3d"],
    [10 * DAY, "1w"],
    [45 * DAY, "1mo"],
    [240 * DAY, "8mo"],
    [400 * DAY, "1y"],
  ])("renders %i ms as %s", (elapsed, label) => {
    expect(humanizeAge(elapsed)).toBe(label);
  });

  it("never goes negative", () => {
    expect(humanizeAge(-DAY)).toBe("just now");
  });
});

describe("ageLabel", () => {
  it("is the bare humanized age below the last rung", () => {
    const row = docRowFixture({ updated: daysAgo(120), stale: "stale" });
    expect(ageLabel(row, NOW)).toBe("4mo");
  });

  it("gains the prototype's `stale · ` prefix at level 3", () => {
    const row = docRowFixture({ updated: daysAgo(240), stale: "very-stale" });
    expect(ageLabel(row, NOW)).toBe("stale · 8mo");
  });

  it("renders an undated document as — rather than NaN or an epoch", () => {
    const row = docRowFixture({ created: null, updated: null, reviewed: null });
    const label = ageLabel(row, NOW);
    expect(label).toBe(UNKNOWN_AGE_LABEL);
    expect(label).not.toContain("NaN");
    expect(label).not.toContain("Invalid");
  });

  it("defaults its clock to now", () => {
    expect(ageLabel(docRowFixture({ updated: new Date().toISOString() }))).toBe("just now");
  });
});
