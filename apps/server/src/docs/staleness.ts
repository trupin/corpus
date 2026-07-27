// Staleness (SPEC.md §5): a document's age runs from `max(updated, reviewed)`
// against the 30/90/180-day ramp, and `evergreen: true` opts out entirely.
//
// One constant backs both readings of that ramp — the `stale=` filter and the
// `stale` Attention reason — so a row the filter returns can never lack the
// reason (sprint-004 TEST-43). Ages are compared as **instant strings**, not as
// day arithmetic: everything on disk is canonical `YYYY-MM-DDTHH:MM:SSZ`
// (core/time.ts), which sorts lexicographically in the same order it sorts
// chronologically, so SQLite can do the comparison against a precomputed cutoff
// without a date function per row.

import { STALE_TIERS, type StaleTier } from "@corpus/contract";
import { formatInstant } from "../core/time.js";

/** SPEC.md §5's default thresholds, in days, ascending. */
export const STALENESS_THRESHOLD_DAYS: Readonly<Record<StaleTier, number>> = {
  aging: 30,
  stale: 90,
  "very-stale": 180,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `max(updated, reviewed)` as SQL over the aliased `documents d`. NULL columns
 * collapse to the empty string rather than poisoning the whole expression the
 * way SQLite's two-argument `max()` does, so an undated document reads as `''`
 * — a value every cutoff comparison rejects, which is what keeps a file with no
 * timestamps out of the ramp instead of pinning it at the far end of it.
 */
export const ACTIVITY_SQL = "MAX(COALESCE(d.reviewed, ''), COALESCE(d.updated, ''))";

/** The instant a document must not have been touched since to reach each tier. */
export type StalenessCutoffs = Readonly<Record<StaleTier, string>>;

export function stalenessCutoffs(nowMs: number): StalenessCutoffs {
  return {
    aging: formatInstant(nowMs - STALENESS_THRESHOLD_DAYS.aging * MS_PER_DAY),
    stale: formatInstant(nowMs - STALENESS_THRESHOLD_DAYS.stale * MS_PER_DAY),
    "very-stale": formatInstant(nowMs - STALENESS_THRESHOLD_DAYS["very-stale"] * MS_PER_DAY),
  };
}

/**
 * SQL for "this row is at or beyond `tier`" (the contract's at-or-beyond
 * reading: `aging` includes stale and very-stale). Binds the cutoff by name so
 * the same fragment can appear in the filter and in the reason without the
 * caller tracking positional order.
 */
export function atOrBeyondSql(tier: StaleTier): string {
  return `(d.evergreen = 0 AND ${ACTIVITY_SQL} <> '' AND ${ACTIVITY_SQL} <= @cutoff_${tierParam(tier)})`;
}

/** Parameter-name-safe spelling of a tier (`very-stale` is not an identifier). */
export function tierParam(tier: StaleTier): string {
  return tier.replace("-", "_");
}

/**
 * The tier a row *is*, for `DocRow.stale` (CONTRACT-005): the highest tier its
 * age reaches, or NULL when it reaches none. `null` is fresh — the tiers name
 * degrees of staleness and freshness is their absence, which is also why the
 * `CASE` carries no `ELSE`.
 *
 * Composed from {@link atOrBeyondSql} in descending tier order rather than from
 * a second comparison against the cutoffs, so the value a row reports and the
 * `stale=` filter that selects it are *literally the same predicate*: a row the
 * filter returns cannot fail to carry the tier, and there is no second constant
 * to drift (sprint-004 TEST-43, extended to the column). Tier names come from
 * the contract's own closed enum, so nothing user-supplied reaches the SQL.
 */
export const STALE_TIER_SQL = `CASE ${[...STALE_TIERS]
  .reverse()
  .map((tier) => `WHEN ${atOrBeyondSql(tier)} THEN '${tier}'`)
  .join(" ")} END`;

// A TypeScript `stalenessTier(activity, evergreen, now)` still deliberately does
// not exist: the tier reaches a row as a column of the collection query, so a
// second implementation of the ramp would have no caller and every opportunity
// to drift from the one the filter uses.
