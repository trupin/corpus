import type { DocRow, StaleTier } from "@corpus/contract";

/**
 * The staleness ramp, consumed rather than recomputed (sprint-009 Open Conflict 5).
 *
 * `DocRow.stale` already arrives as a tier, computed by the server against the
 * workspace's own thresholds (SPEC.md §5 — `max(updated, reviewed)` against
 * 30/90/180 days by default). Three of the server's decisions are invisible to a
 * client that redoes the arithmetic, and each one is a visible bug:
 *
 * - **`null` is fresh.** The tiers name degrees of staleness; freshness is their
 *   absence, which is why the `stale=` filter takes a tier and never `fresh`.
 * - **`evergreen: true` is always `null`**, whatever the timestamps say.
 * - **An unknown age is `null`, not an ancient one.** A hand-written `SKILL.md`
 *   carries no frontmatter timestamps, so `updated` and `reviewed` are both
 *   null. A client computing `now - max(updated, reviewed)` renders it as
 *   maximally stale, complete with archive-or-act buttons, while the server's
 *   own `stale=` filter calls it fresh — and the column and the row then
 *   disagree about the same document.
 *
 * So the thresholds do not appear in this package at all: they are the server's,
 * and a workspace that retunes them retunes exactly one place. What is genuinely
 * the client's is the ramp's *rendering* — the level the prototype's `.age-N`
 * classes key off, and the humanized age label, both below.
 */

/** Level 0 (fresh) through 3 (very stale) — the prototype's `.row.age-N` ladder. */
export type StalenessLevel = 0 | 1 | 2 | 3;

const LEVEL_BY_TIER: Readonly<Record<StaleTier, StalenessLevel>> = {
  aging: 1,
  stale: 2,
  "very-stale": 3,
};

/**
 * Maps the server's tier onto the ladder. Total: an unrecognised tier (a server
 * ahead of this kit) degrades to fresh rather than to "very stale", because
 * inventing an archive prompt for a document nobody said was old is the worse
 * of the two failures.
 */
export function stalenessLevel(tier: StaleTier | null | undefined): StalenessLevel {
  if (tier === null || tier === undefined) return 0;
  return LEVEL_BY_TIER[tier] ?? 0;
}

/** The class the prototype puts on a row: `""` at level 0, `age-1`…`age-3` above it. */
export function stalenessClass(level: StalenessLevel): string {
  return level === 0 ? "" : `age-${String(level)}`;
}

/** Only the last rung grows the quick actions (Archive · Still current · @agent triage). */
export function hasStaleActions(level: StalenessLevel): boolean {
  return level === 3;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** The prototype's calendar-ish months and years; a label, never an interval calculation. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** What a row shows for a document whose age nothing on the wire can date. */
export const UNKNOWN_AGE_LABEL = "—";

/**
 * The instant a row's age runs from: `max(updated, reviewed)`, per SPEC.md §5.
 *
 * `reviewed` newer than `updated` is the normal case after "still current", and
 * `reviewed` in the future is a clock-skew case that `max` absorbs. Both null
 * means the age is unknown — which is *not* zero and not the epoch.
 */
export function ageAnchor(
  row: Pick<DocRow, "created" | "updated" | "reviewed">,
): number | undefined {
  const instants = (values: readonly (string | null)[]): number[] =>
    values
      .filter((value): value is string => value !== null)
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));

  // `created` is a fallback, not a third candidate: a document that has been
  // edited is not as old as the day it was made, so it may only speak when
  // neither of the two age-bearing fields does.
  const dated = instants([row.updated, row.reviewed]);
  const pool = dated.length > 0 ? dated : instants([row.created]);
  return pool.length === 0 ? undefined : Math.max(...pool);
}

/**
 * The prototype's humanized elapsed time — `just now`, `3d`, `3mo`, `2y`.
 *
 * One formatter, so every surface agrees. Never negative (a future timestamp
 * reads `just now`) and never `NaN`: an undated row gets {@link UNKNOWN_AGE_LABEL},
 * which is what `DocRow`'s own nullable-timestamp note asks for.
 */
export function humanizeAge(elapsedMs: number): string {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < HOUR_MS) return "just now";
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h`;
  if (elapsed < WEEK_MS) return `${String(Math.floor(elapsed / DAY_MS))}d`;
  if (elapsed < MONTH_MS) return `${String(Math.floor(elapsed / WEEK_MS))}w`;
  if (elapsed < YEAR_MS) return `${String(Math.max(1, Math.floor(elapsed / MONTH_MS)))}mo`;
  return `${String(Math.floor(elapsed / YEAR_MS))}y`;
}

/**
 * The row's age chip text: `3mo`, and `stale · 8mo` once the ramp's last rung is
 * reached — the prototype's two spellings, chosen by the server's tier rather
 * than by a second threshold check.
 */
export function ageLabel(
  row: Pick<DocRow, "created" | "updated" | "reviewed" | "stale">,
  now: Date = new Date(),
): string {
  const anchor = ageAnchor(row);
  if (anchor === undefined) return UNKNOWN_AGE_LABEL;
  const humanized = humanizeAge(now.getTime() - anchor);
  return stalenessLevel(row.stale) === 3 ? `stale · ${humanized}` : humanized;
}
