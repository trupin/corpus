import type { Job } from "@corpus/contract";
import {
  OUTSTANDING_JOB_STATUSES,
  OUTSTANDING_JOB_STATUS_PARAM,
  useJobs,
  useOutstandingJobs,
} from "@corpus/kit";

/**
 * Whether an agent response is **outstanding** for a thread — the one question
 * SPEC.md §8's pending indicator answers, and the one the thread's own fields
 * cannot.
 *
 * **Why `Thread.agent` is not the signal.** That field records whether the agent
 * *participates* — `none → requested → engaged` — and it never travels back: the
 * server sets `requested` on the first agent-requesting turn and `engaged` on the
 * agent's first reply, and nothing lowers it again (`participation.ts`'s
 * `nextAgentState`; not a reply, not a resolve, not a `requestsAgent: false`
 * turn). So `agent !== "none" && lastTurn.author !== "agent"` reads *"the agent
 * was drawn in at some point, and a human spoke last"*, which is exactly as true
 * of a "note only" turn added long after the agent answered as it is of a real
 * ask — and the `.working` row appeared for a job nobody had asked for (UI-058).
 *
 * **Why there is no per-turn signal either.** `requestsAgent` is a request-time
 * instruction rather than a property of the turn: a turn on disk is `## <author>
 * · <ts>` and its body (SPEC.md §6), and `TurnSchema` carries `{author, ts,
 * body}`. That a given turn enqueued is recorded nowhere a later reader — a
 * reload, a second tab, another column showing the same thread — can find it.
 *
 * **What is left is the queue, and the queue is the right answer anyway.** A
 * response is outstanding precisely while the event the request enqueued is
 * unfinished, and the server publishes every queue event as a job whose
 * `originId` is the document its payload names — a thread, for the
 * `comment.created` and `form.respond` events a conversation produces (SPEC.md
 * §7, §11). That is a fact the server maintains rather than an inference from who
 * spoke last: it survives a reload, and it is right in a tab that did not send
 * the turn.
 *
 * ---
 *
 * **The question is asked on the wire, so the answer has no window** (UI-069,
 * on CONTRACT-030 → SERVER-056). This used to read the console's own
 * `useJobs({})` — the shared `["jobs", {}]` key — and scan it, which meant the
 * answer was only ever *"as far as the 50 most recently touched jobs can tell"*.
 * The error that produced was one-directional and silent: a job whose `updated`
 * stopped advancing sank below the cut-off while the rest of the queue moved,
 * and the `.working` row vanished while the reply was still coming. A
 * **deferred** job is the ordinary way to get there — SPEC.md §7 has a deferral
 * wait indefinitely on an edit lock — and a `pending` job behind a long backlog
 * reaches the same place.
 *
 * Asking the **status** on the wire is what fixes that, and it is asked once for
 * the whole app: `useOutstandingJobs()` (kit) is the queue's unfinished work
 * under a single cache key, and the console's window cannot bury anything in it
 * because settled jobs are no longer in the list at all. A deferred job waiting
 * indefinitely behind any amount of *finished* traffic is still there.
 *
 * ---
 *
 * **What this hook must not do is ask per thread** (UI-075). UI-069 answered the
 * completeness problem with `?originId=…`, which is answered completely — and
 * put the request on a cache key per thread id. The claim that paid for it, "this
 * hook runs in an open thread reader, of which there are as many as the user has
 * columns open", was simply false: `ThreadCard` mounts once per **thread** —
 * `anchors/AnchoredThreads.tsx`'s margin column maps one card per anchored
 * thread, which is SPEC.md §11's placement for focus mode and wide readers, and
 * child threads mount recursively under their parent. A document with thirty
 * anchored comments therefore issued thirty concurrent `/api/jobs` requests,
 * each an unindexed scan over a `json_extract` `CASE`, all refetching on every
 * `["jobs"]` invalidation the queue emits — on every transition.
 *
 * So the shared query is the ordinary path, and the exact one is kept for the
 * only case that can still be short: more unfinished events at one instant than
 * a single response carries (`OutstandingJobs.truncated`). That is a bound on
 * *concurrent* work rather than on history, the escalation is per thread only
 * while it holds, and the completeness UI-069 bought is not given back.
 */

/**
 * Queue states in which the agent still owes this thread an answer — SPEC.md
 * §7's three non-terminal outcomes, taken from the kit rather than restated so
 * the filter that goes to the server and the predicate applied to its answer
 * cannot drift apart. `OUTSTANDING_JOB_STATUSES`' own docblock says why
 * `deferred` is one of them.
 */
const OUTSTANDING_STATUSES = OUTSTANDING_JOB_STATUSES;

/** Sorting key that never throws a job out of the list for an unreadable stamp. */
function startedAt(job: Job): number {
  const at = Date.parse(job.started);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * The oldest unfinished job for `threadId` among `jobs`, or `null`.
 *
 * Oldest rather than newest: two queued events are one wait as far as the person
 * looking at the card is concerned, and it began with the first of them.
 *
 * Split out from the hook because picking the oldest is this module's own rule,
 * not the server's: `GET /api/jobs` orders by most-recently-active, and no query
 * parameter asks for "the one that has been waiting longest". The **origin check
 * is this module's too** on the ordinary path, where the list is every
 * outstanding job in the corpus rather than this thread's; the status check is
 * the server's as well, and is kept rather than dropped so the function is total
 * over any list, including the ones its tests hand it directly.
 *
 * Exhaustive over what it is given: no cap, no early exit, a match at position
 * 500 is found.
 */
export function pickOutstandingJob(jobs: readonly Job[], threadId: string): Job | null {
  let oldest: Job | null = null;
  for (const job of jobs) {
    if (job.originId !== threadId) continue;
    if (!OUTSTANDING_STATUSES.includes(job.status)) continue;
    if (oldest === null || startedAt(job) < startedAt(oldest)) oldest = job;
  }
  return oldest;
}

/**
 * The oldest unfinished job this thread is waiting on, or `null`.
 *
 * **One request for every card on the screen, and a complete answer anyway.**
 * The ordinary read is the shared outstanding query — one cache entry for the
 * whole app, whatever the document's comment count — and the per-thread
 * `?originId=` question is issued only while that answer reports itself
 * possibly short, which takes `MAX_RECENT_JOBS` events unfinished at the same
 * instant.
 *
 * The fallback is read only while `truncated` holds, rather than whenever it has
 * data: TanStack keeps a parked query's last answer cached, and a queue that has
 * drained back under the cap would otherwise be answered from a snapshot of when
 * it was over it. While the escalation is in flight the shared list still
 * answers — the best available reading, and never a worse one than the caller
 * had a moment ago.
 */
export function useOutstandingAgentJob(threadId: string): Job | null {
  const outstanding = useOutstandingJobs();
  const exact = useJobs(
    { originId: threadId, status: OUTSTANDING_JOB_STATUS_PARAM },
    { enabled: outstanding.truncated },
  );
  const jobs = outstanding.truncated ? (exact.data?.jobs ?? outstanding.jobs) : outstanding.jobs;
  return pickOutstandingJob(jobs, threadId);
}

/** The one field of a turn this module needs: when it was posted. */
export interface TurnInstant {
  readonly ts: string;
}

/**
 * When the wait began — what `PendingIndicator` counts from.
 *
 * **`Job.started` means two different instants** (CONTRACT-029, filed). It is the
 * queue event's own `created` — the moment the requesting turn was posted, since
 * the enqueue happens inside that request — right up until the job writes its
 * first log line, after which the server records *that* line's timestamp and
 * never moves the field again (`recordJobLine`'s `COALESCE`). Reported raw, a job
 * that sat pending for ten minutes would therefore **reset** the elapsed clock
 * the instant the agent started talking, which is the "reloading must not restart
 * the wait" lie `PendingIndicator` exists to avoid.
 *
 * The thread's own turns bound it, because the requesting turn is a turn *of this
 * thread* and it cannot be newer than the enqueue. So: **the newest turn that is
 * not newer than `job.started`**. While the job is queued that is the requesting
 * turn itself and the instant is exact; once the job's start has run ahead of the
 * request it holds the clock at the latest instant the request could possibly
 * have been made, instead of restarting it.
 *
 * **Newest-not-newer rather than simply the latest turn**, which is what this did
 * before and is where the review of PR #21 found it stepping. `min(job.started,
 * latestTurn)` is the minimum of two values that only ever increase, so it only
 * ever increases too: ask at 10:05, first log at 10:07 (`started` → 10:07), then a
 * note-only turn at 10:25 — and `since` moves 10:05 → 10:07, so the displayed wait
 * jumps *down* by two minutes. Filtering by `started` instead of taking the
 * minimum makes turns posted after the job's recorded start irrelevant, which is
 * every turn in that scenario, and the clock holds at 10:05. The answer is also
 * never *later* than the old one — it is a turn, and it is ≤ `job.started` — so it
 * cannot over-report a wait either.
 *
 * **What it still cannot do, and why.** A turn posted in the gap between the
 * enqueue and the first log — a note at 10:06 in the example — enters the
 * eligible set when `started` steps to 10:07, and `since` moves 10:05 → 10:06.
 * The step is bounded by (first log − enqueue) and it is the same step the
 * previous implementation had there; removing it needs the enqueue instant as a
 * field of its own, which is exactly CONTRACT-029. The test named for it records
 * the behaviour rather than blessing it.
 */
export function agentWaitSince(job: Job, turns: readonly TurnInstant[]): string {
  const started = Date.parse(job.started);
  if (Number.isNaN(started)) return job.started;
  let since: string | null = null;
  let sinceAt = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    const at = Date.parse(turn.ts);
    // An unreadable stamp is not evidence about when anything happened, so it
    // neither bounds the clock nor disqualifies the turns around it.
    if (Number.isNaN(at) || at > started) continue;
    if (at >= sinceAt) {
      since = turn.ts;
      sinceAt = at;
    }
  }
  return since ?? job.started;
}
