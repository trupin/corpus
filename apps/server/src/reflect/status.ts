// The three projection reads behind `GET /api/workspace/reflect` (SPEC.md §7).

import type { Actor, DocStatus } from "@corpus/contract";
import { WORKSPACE_REFLECT_EVENT_TYPE, isUnreflected } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";

/**
 * The statuses that make a reflection "pending or in progress" — the set
 * `POST /api/workspace/reflect` answers with instead of enqueuing a second, and
 * the set the quiet window's third condition asks about.
 *
 * `deferred` is in here with the other two and it is the one worth stating: a
 * deferred event is claimed work the agent parked because somebody was editing,
 * and §7 returns it to `pending` by itself when that session ends. It is a
 * reflection that is going to happen, so asking for another would double it.
 */
const LIVE_REFLECTION_STATUSES = ["pending", "in-progress", "deferred"] as const;

/**
 * The `workspace.reflect` event that is going to run, or `null`.
 *
 * Read from the projection's `events` table rather than by listing five
 * directories: the mirror is written synchronously by every transition, before
 * the response that caused it, so it is never behind the queue by the time
 * anybody can ask.
 *
 * The **oldest** one, if the invariant ever slipped and there were two: the one
 * that will be claimed first is the honest answer to "which reflection is
 * already going to happen".
 */
export function findLiveReflection(db: ProjectionDb): string | null {
  const row = db
    .prepare(
      `SELECT id FROM events
       WHERE type = ? AND status IN (${LIVE_REFLECTION_STATUSES.map(() => "?").join(", ")})
       ORDER BY created ASC, id ASC
       LIMIT 1`,
    )
    .get(WORKSPACE_REFLECT_EVENT_TYPE, ...LIVE_REFLECTION_STATUSES) as { id: string } | undefined;
  return row?.id ?? null;
}

interface UnreflectedRow {
  readonly updated: string | null;
  readonly last_actor: string;
  readonly status: string;
}

/**
 * How many documents are unreflected (SPEC.md §7's `changed`).
 *
 * **The predicate is not written here.** `isUnreflected` is the contract's, and
 * UI-153 marks each board row with the very same function — a count and a set of
 * marks that disagreed would be worse than either alone, and a second predicate
 * that "means the same thing" is how they come to disagree. So the SQL selects
 * the three columns the predicate reads and decides nothing: no `WHERE` clause
 * here restates "not the agent's", "not archived" or "later than the clock",
 * because each of those is a clause of the rule and a copy of a clause is a copy
 * of the rule.
 *
 * A whole-table read is what that costs. It is three small columns per document
 * with no join and no index probe — under a millisecond on a corpus of a
 * thousand — and the alternative is a divergence nobody would notice until a
 * board said "3 changes" over four marked rows.
 */
export function countUnreflected(db: ProjectionDb, reflected: string | null): number {
  const rows = db
    .prepare("SELECT updated, last_actor, status FROM documents")
    .all() as UnreflectedRow[];
  let count = 0;
  for (const row of rows) {
    const document = {
      updated: row.updated,
      lastActor: row.last_actor as Actor,
      status: row.status as DocStatus,
    };
    if (isUnreflected(document, reflected)) count += 1;
  }
  return count;
}

/**
 * The recorded digest thread, if it is still there.
 *
 * Checked against the projection rather than reported from the clock file
 * alone: a person may delete the digest thread, and a Reflect control whose
 * "reflected 2h ago" opened a 404 would be worse than one that simply does not
 * link. The clock file is not rewritten for it — the thread may come back
 * through git — so this is a read-time answer.
 */
export function resolveDigest(db: ProjectionDb, digest: string | null): string | null {
  if (digest === null) return null;
  const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(digest) as
    { id: string } | undefined;
  return row === undefined ? null : digest;
}
