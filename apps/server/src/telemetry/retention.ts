// Retention for SPEC.md §9.4's cost ledger — the one time-based delete in this
// server, and the reasoning for where it was put.

import type { Logger } from "../logger.js";
import type { ProjectionDb } from "../projection/index.js";

/**
 * How long a raw ledger row survives: **90 days.**
 *
 * The decision is raw rows only, pruned at this window, and **bucketed on read**
 * — no aggregate table (sprint-025 O3). A second table would be a second source
 * of truth for one number, and it would have to be maintained on the very path
 * §9.4 requires to cost nothing. At one row per invocation-subject the read cost
 * does not justify it: if the series is ever slow, that is a measured issue with
 * a measurement attached.
 *
 * Ninety days is chosen against the question the panel asks — *is working with
 * this document getting more expensive as it grows?* — which needs enough
 * history to show a trend and gains nothing from a year of it. It is also what
 * bounds the series: a document's history is at most this many daily buckets
 * however old the document is, which is why `GET /api/docs/{id}/cost` can
 * default to a bound past it and still normally answer `truncated: false`.
 */
export const TELEMETRY_RETENTION_DAYS = 90;

export const TELEMETRY_RETENTION_MS = TELEMETRY_RETENTION_DAYS * 86_400_000;

/**
 * How often a long-running server re-prunes. Daily, matching the bucket: a
 * window measured in days does not need sweeping more often than a day, and the
 * rows one day adds are a rounding error against the ones already there.
 */
export const TELEMETRY_PRUNE_INTERVAL_MS = 86_400_000;

/**
 * Deletes ledger rows older than the retention window, and answers how many
 * went.
 *
 * An index range delete on `telemetry_at`, not a scan: `at_ms` is stored as
 * epoch milliseconds precisely so this comparison is integer arithmetic against
 * an index rather than a date function applied to every row.
 */
export function pruneTelemetry(db: ProjectionDb, now: number): number {
  return db.prepare("DELETE FROM telemetry WHERE at_ms < ?").run(now - TELEMETRY_RETENTION_MS)
    .changes;
}

export interface TelemetryRetentionDeps {
  readonly db: ProjectionDb;
  readonly logger: Logger;
  readonly now?: (() => number) | undefined;
}

/**
 * Prunes once and then daily, and answers with the disposer that stops the
 * timer.
 *
 * ## Why not on the ingestion path
 *
 * Because §9.4 says that channel must cost the command nothing, and a prune
 * there would put a delete — however cheap — on every `corpus` invocation in the
 * workspace. The measurement channel paying for its own housekeeping on the hot
 * path is exactly the shape the feature exists to make visible.
 *
 * ## Why not on the read path
 *
 * Because the read path is the panel's, and a `GET` that writes is a surprise a
 * reviewer is right to stop at. It would also prune only for workspaces somebody
 * happens to open the panel in.
 *
 * ## Why boot plus a daily timer is safe where it is
 *
 * - It deletes only `telemetry` rows strictly older than the window, addressed
 *   by an index on the one column retention cares about. Nothing else in the
 *   schema references those rows, so there is no cascade and nothing to orphan.
 * - `better-sqlite3` is synchronous, so the delete cannot interleave with a
 *   request on the same connection — there is no window in which a series read
 *   sees half a prune.
 * - It cannot run during a rebuild. A rebuild builds a **fresh** database and
 *   carries no telemetry into it, so there is nothing there to prune and no
 *   wall-clock value enters a comparison that must not carry one
 *   (`projection/rebuild.test.ts`'s determinism check).
 * - The timer is `unref`'d, so it never holds a process open, and the disposer
 *   clears it at shutdown.
 */
export function startTelemetryRetention(deps: TelemetryRetentionDeps): () => void {
  const clock = deps.now ?? Date.now;
  const sweep = (): void => {
    const removed = pruneTelemetry(deps.db, clock());
    if (removed > 0) {
      deps.logger.debug("pruned cost telemetry", { removed, days: TELEMETRY_RETENTION_DAYS });
    }
  };

  sweep();
  const timer = setInterval(sweep, TELEMETRY_PRUNE_INTERVAL_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
  };
}
