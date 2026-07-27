import { describe, expect, it } from "vitest";
import { formatInstant } from "../core/time.js";
import {
  atOrBeyondSql,
  STALENESS_THRESHOLD_DAYS,
  stalenessCutoffs,
  tierParam,
} from "./staleness.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => formatInstant(NOW - days * MS_PER_DAY);

describe("stalenessCutoffs", () => {
  it("is the SPEC.md §5 ramp, in canonical instants", () => {
    const cutoffs = stalenessCutoffs(NOW);
    expect(cutoffs).toEqual({
      aging: daysAgo(STALENESS_THRESHOLD_DAYS.aging),
      stale: daysAgo(STALENESS_THRESHOLD_DAYS.stale),
      "very-stale": daysAgo(STALENESS_THRESHOLD_DAYS["very-stale"]),
    });
    expect(cutoffs["very-stale"] < cutoffs.stale).toBe(true);
    expect(cutoffs.stale < cutoffs.aging).toBe(true);
  });
});

describe("atOrBeyondSql", () => {
  it("excludes evergreen rows and rows with no known age, and binds the tier's cutoff", () => {
    const sql = atOrBeyondSql("very-stale");
    expect(sql).toContain("d.evergreen = 0");
    expect(sql).toContain("<> ''");
    expect(sql).toContain(`@cutoff_${tierParam("very-stale")}`);
  });

  it("spells a tier as a legal parameter name", () => {
    expect(tierParam("very-stale")).toBe("very_stale");
    expect(tierParam("stale")).toBe("stale");
  });
});
