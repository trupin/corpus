import type { Job, QueueEventStatus } from "@corpus/contract";
import { useJobs } from "@corpus/kit";

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
 * **What this actually guarantees, and inside what window.** `useJobs({})` is the
 * console's own query — the shared `["jobs", {}]` key, so a board full of cards
 * issues one request and repaints on the SSE invalidation the queue already emits
 * on every transition. The price of sharing it is that the console's *shape* is
 * the only shape on offer: `JobsQuerySchema` carries `recent` and nothing else,
 * so the server answers with the **`DEFAULT_RECENT_JOBS` (50) most recently
 * touched** jobs, ordered `COALESCE(j.updated, e.created) DESC`
 * (`apps/server/src/jobs/project.ts`'s `listJobRows`). Everything below therefore
 * reads: *the agent owes this thread an answer, as far as the 50 most recently
 * touched jobs can tell.*
 *
 * Inside that window the answer is exact. Outside it the error is
 * one-directional, and it is a false **negative**: a job whose `updated` has
 * stopped advancing sinks below the cut-off while the rest of the queue moves,
 * and this returns `null` while the reply is still genuinely coming. A
 * **deferred** job is the standard way to get there — SPEC.md §7 has a deferral
 * wait indefinitely on an edit lock, with `corpus job retry` as the manual
 * override for a lock that never clears — and a `pending` job behind a long
 * backlog reaches the same place. The row disappears; the wait does not. That is
 * the same dishonesty UI-058 was filed to remove, pointing the other way.
 *
 * **Why it is not fixed here.** The wire cannot be asked the question this caller
 * has. There is no `originId` filter and no `status` filter, and `listJobRows`
 * has no `WHERE` to hang one on. The two fixes available above the wire are both
 * worse than the bound: raising `recent` moves the boundary without removing it
 * (and, since the bound rides on the shared key, forks this caller's request away
 * from the console's for the privilege), and polling harder does not widen
 * anything at all. A row that is wrong less often is still wrong. The honest fix
 * is a filtered query, which is a contract and a server change — CONTRACT-030 →
 * SERVER-056 → UI-069. Until those land the bound is written down rather than
 * hidden, and `outstandingAgentRequest.test.ts` pins it so the day it changes is
 * a failing test rather than a surprise.
 */

/**
 * Queue states in which the agent still owes this thread an answer.
 *
 * `deferred` counts: SPEC.md §7 makes it the one **non-terminal** outcome —
 * claimed work parked on a document's edit lock, returned to `pending`
 * automatically when that lock is released, broken or reaped. The reply is still
 * coming, so the wait is real and saying nothing about it would be the same lie
 * in the other direction. `processed`, `failed` and `abandoned` are terminal:
 * nothing more arrives without someone asking again.
 */
const OUTSTANDING_STATUSES: readonly QueueEventStatus[] = ["pending", "in-progress", "deferred"];

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
 * Split out from the hook because the scan and the window are separate claims.
 * This function is exhaustive over what it is given — no cap, no early exit, a
 * match at position 500 is found — and every limit on the answer comes from the
 * list, which is the module docblock's subject.
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
 * The oldest unfinished job this thread is waiting on, or `null` — **within the
 * server's most-recent-jobs window**, whose extent and failure mode the module
 * docblock states in full.
 */
export function useOutstandingAgentJob(threadId: string): Job | null {
  const jobs = useJobs({});
  return pickOutstandingJob(jobs.data?.jobs ?? [], threadId);
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
