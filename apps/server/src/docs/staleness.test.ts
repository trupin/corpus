import { describe, expect, it } from "vitest";
import { formatInstant } from "../core/time.js";
import {
  ACTIVITY_SQL,
  atOrBeyondSql,
  STALENESS_THRESHOLD_DAYS,
  STALE_TIER_SQL,
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

  /**
   * SPEC.md §5's **second** exemption (SERVER-107): "a `resolved` or `archived`
   * document does not age … a second exemption beside `evergreen` rather than a
   * replacement for it", which §9.2 publishes as a route-level guarantee.
   *
   * Pinned as the positive test rather than as "does not mention resolved":
   * `= 'open'` is what makes `archived` — and any status the enum grows later —
   * exempt through the same clause, so a rewrite into two negations is a
   * regression this test is supposed to notice.
   */
  it("ages open documents only — the status exemption §5 puts beside evergreen", () => {
    for (const tier of ["aging", "stale", "very-stale"] as const) {
      expect(atOrBeyondSql(tier)).toContain("d.status = 'open'");
    }
  });

  /**
   * The predicate is a conjunction of exactly four facts, and the count is the
   * assertion: a fifth would be a rule nobody wrote down, and a dropped one is
   * either the ramp ageing what §5 exempts or the exemption swallowing the ramp.
   */
  it("is those four conjuncts and nothing else", () => {
    const sql = atOrBeyondSql("stale");
    expect(sql.startsWith("(")).toBe(true);
    expect(sql.endsWith(")")).toBe(true);
    expect(sql.slice(1, -1).split(" AND ")).toEqual([
      "d.status = 'open'",
      "d.evergreen = 0",
      `${ACTIVITY_SQL} <> ''`,
      `${ACTIVITY_SQL} <= @cutoff_stale`,
    ]);
  });

  it("spells a tier as a legal parameter name", () => {
    expect(tierParam("very-stale")).toBe("very_stale");
    expect(tierParam("stale")).toBe("stale");
  });
});

describe("STALE_TIER_SQL", () => {
  it("tests the tiers from the worst down, so a row reports the highest it reached", () => {
    expect(STALE_TIER_SQL.indexOf("'very-stale'")).toBeLessThan(STALE_TIER_SQL.indexOf("'stale'"));
    expect(STALE_TIER_SQL.indexOf("'stale'")).toBeLessThan(STALE_TIER_SQL.indexOf("'aging'"));
  });

  it("is built from the filter's own predicate, so the two cannot disagree", () => {
    for (const tier of ["aging", "stale", "very-stale"] as const) {
      expect(STALE_TIER_SQL).toContain(`WHEN ${atOrBeyondSql(tier)} THEN '${tier}'`);
    }
  });

  it("has no ELSE — freshness is the absence of a tier, which SQL spells NULL", () => {
    expect(STALE_TIER_SQL).not.toContain("ELSE");
    expect(STALE_TIER_SQL.startsWith("CASE ")).toBe(true);
    expect(STALE_TIER_SQL.endsWith(" END")).toBe(true);
  });
});
