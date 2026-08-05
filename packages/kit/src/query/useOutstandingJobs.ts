import { MAX_RECENT_JOBS, type Job, type QueueEventStatus } from "@corpus/contract";
import { useJobs } from "./useJobs.js";

/**
 * The queue's **currently unfinished work**, as one query the whole app shares.
 *
 * Two surfaces ask a question of this shape and neither is asking about a
 * document: a board row asks "is the agent working on this row?" (SPEC.md §8's
 * dot) and a thread card asks "does the agent still owe this thread an answer?"
 * (§8's pending row). Both are predicates over the *same small set* — the events
 * the queue has not settled — so they are one request, cached under one key,
 * repainted by the one `["jobs"]` invalidation the queue emits on every
 * transition.
 *
 * **That the set is small is the load-bearing fact.** The console's own query is
 * "what has the queue been doing", which grows without bound and wants a window;
 * this one is "what is the queue still doing", which the queue actively drains.
 * A single-writer local queue holds a handful of unsettled events, not a
 * hundred, and every consumer scanning the same handful costs one request no
 * matter how many consumers there are — a document with thirty anchored comments
 * in the margin, a column of two hundred rows, and both at once.
 *
 * **Why it is not a filtered query per asker** (UI-075, the regression UI-069
 * introduced). `?originId=…` is answered completely, which is why UI-069 reached
 * for it — but it is a distinct cache key per id, so one query per thread card
 * is one request per thread card, thirty of them concurrent on an ordinary
 * document in focus mode, every one an unindexed scan, all thirty refetching on
 * every queue transition. The complete answer stays available for the case that
 * needs it (see {@link OutstandingJobs.truncated}); it is no longer the ordinary
 * path.
 *
 * **The window here is not the window UI-069 removed.** `recent` still bounds
 * this response, but it bounds it over *unsettled* rows only. What broke before
 * was that settled churn consumed the window: every processed job pushed a
 * deferred one further down a list ordered by recency, so an indefinitely
 * waiting job was guaranteed to fall out eventually. Filtered to the three
 * non-terminal states, nothing settled can push anything out at all, and the
 * only way to overflow is more than {@link MAX_RECENT_JOBS} events unfinished at
 * the same instant. That is reported rather than swallowed, so a caller that
 * must be exact can be.
 */

/**
 * Queue states in which work is genuinely still outstanding.
 *
 * SPEC.md §7's three non-terminal outcomes. `deferred` counts: it is claimed
 * work parked on a document's edit lock, returned to `pending` automatically
 * when that lock is released, broken or reaped — the reply is still coming.
 * `processed`, `failed` and `abandoned` are terminal: nothing more arrives
 * without someone asking again.
 */
export const OUTSTANDING_JOB_STATUSES: readonly QueueEventStatus[] = [
  "pending",
  "in-progress",
  "deferred",
];

/**
 * The same three states as the `status` query parameter spells them. Derived
 * from the list above rather than written out, so the filter sent to the server
 * and any predicate applied to its answer can never disagree about what
 * "outstanding" means.
 */
export const OUTSTANDING_JOB_STATUS_PARAM = OUTSTANDING_JOB_STATUSES.join(",");

export interface OutstandingJobs {
  /** Every unfinished job the server returned, most recently active first. */
  readonly jobs: readonly Job[];
  /**
   * The answer came back **at the cap**, so there may be unfinished jobs it does
   * not name.
   *
   * Sound in both directions: the server applies `recent` as a `LIMIT` over the
   * filtered rows, so fewer rows than the cap is proof the list is complete, and
   * exactly the cap is the only case where it might not be. A caller whose
   * answer must be exact — a thread card deciding whether to say "working…" —
   * asks its own `?originId=` question while this is true, and only while it is
   * true.
   */
  readonly truncated: boolean;
}

/** The queue's unfinished work (SPEC.md §7, §8). One request for the whole app. */
export function useOutstandingJobs(): OutstandingJobs {
  const query = useJobs({ status: OUTSTANDING_JOB_STATUS_PARAM, recent: MAX_RECENT_JOBS });
  const jobs = query.data?.jobs ?? [];
  return { jobs, truncated: jobs.length >= MAX_RECENT_JOBS };
}
