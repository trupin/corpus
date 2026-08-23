// Staleness (SPEC.md §5): a document's age runs from `max(updated, reviewed)`
// against the 30/90/180-day ramp — **for documents that are `open`** — and
// `evergreen: true` opts out entirely.
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

/**
 * How many days without activity each tier begins at. Ascending, positive, and
 * exactly three — one per tier the contract declares, so a tier cannot be
 * configured into or out of existence.
 */
export type StalenessThresholds = Readonly<Record<StaleTier, number>>;

/**
 * SPEC.md §5's **default** thresholds, in days, ascending.
 *
 * The spec has always called these defaults, and until SERVER-133 nothing could
 * override them: this was a constant with a comment claiming otherwise, and the
 * only lever anyone had was marking reference material `evergreen` one document
 * at a time. A workspace now sets its own in `.corpus/config.json`'s `staleness`
 * block; these are what it falls back to, and what the word "defaults" in §5
 * now names.
 */
export const STALENESS_THRESHOLD_DAYS: StalenessThresholds = {
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

/**
 * The three cutoffs, from the clock and the workspace's thresholds.
 *
 * **This is the only place the numbers enter the system** (SERVER-133). The SQL
 * — {@link atOrBeyondSql} and {@link STALE_TIER_SQL} — binds `@cutoff_<tier>` by
 * name and carries no day count of its own, so configuring the ramp changes
 * what a query *binds* and never what any projected row holds. That is what
 * makes the answer to "what happens to the projection when they change" be
 * *nothing*: no row stores a tier, `db rebuild` writes the same bytes it did
 * before, and `db doctor` cannot notice the edit — which is the point, since a
 * doctor that failed after a legal config edit would be worse than no config.
 *
 * `thresholds` defaults to the shipped ramp for the same reason the write
 * fixture's `attachments` and `editAckIdleMs` do: a caller with no opinion
 * states none, and the suites that prove the config is *read* pass their own.
 */
export function stalenessCutoffs(
  nowMs: number,
  thresholds: StalenessThresholds = STALENESS_THRESHOLD_DAYS,
): StalenessCutoffs {
  return {
    aging: formatInstant(nowMs - thresholds.aging * MS_PER_DAY),
    stale: formatInstant(nowMs - thresholds.stale * MS_PER_DAY),
    "very-stale": formatInstant(nowMs - thresholds["very-stale"] * MS_PER_DAY),
  };
}

/**
 * SQL for "this row is at or beyond `tier`" (the contract's at-or-beyond
 * reading: `aging` includes stale and very-stale). Binds the cutoff by name so
 * the same fragment can appear in the filter and in the reason without the
 * caller tracking positional order.
 *
 * **There are two exemptions from the ramp, not one** (SERVER-107). `evergreen`
 * is the one a person sets on reference material; `status` is the other, and it
 * is the document answering the ramp's own question. §5: "a `resolved` or
 * `archived` document does not age, because the ramp asks whether something
 * still needs attention and that document has answered … a second exemption
 * beside `evergreen` rather than a replacement for it", which §9.2 then publishes
 * as a route-level guarantee — `needs=stale` answers for `open` documents only,
 * and such a row "never enters the union on that reason".
 *
 * Spelled positively (`= 'open'`) rather than as two negations. §5 defines the
 * ramp *for open documents*: a status this predicate has never heard of should
 * default to not ageing rather than to ageing, and `archived` — which is
 * `resolved` plus hidden — is then covered by the same clause that covers
 * `resolved` instead of by a second one somebody has to remember to add.
 *
 * The term belongs **here** rather than beside the three call sites for the
 * reason the tier column exists here too: the `stale=` filter, the `stale`
 * Attention reason and `DocRow.stale` are all this one fragment, so a document
 * that stopped ageing stops on all three at once and no surface can keep
 * offering a reason another has retired. It is also why resolving a stale
 * document *removes* it from the set (§5: "leaves the stale set if it was
 * already in it") with no dates rewritten and nothing to re-stamp: the row's
 * age is untouched and simply no longer consulted.
 *
 * Note what this does **not** do: a resolved document keeps its place in every
 * list (§5), so nothing here narrows a result set. Only the ramp stops.
 */
export function atOrBeyondSql(tier: StaleTier): string {
  return `(d.status = 'open' AND d.evergreen = 0 AND ${ACTIVITY_SQL} <> '' AND ${ACTIVITY_SQL} <= @cutoff_${tierParam(tier)})`;
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
