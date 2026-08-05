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
 * spoke last: it survives a reload, it is right in a tab that did not send the
 * turn, and it goes quiet the moment the job is settled. It also costs nothing
 * extra — `useJobs({})` is the console's and the row signals' query under one
 * shared key, so a board full of cards issues one request and repaints on the SSE
 * invalidation the queue already emits on every transition.
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
 * The oldest unfinished job this thread is waiting on, or `null`.
 *
 * Oldest rather than newest: two queued events are one wait as far as the person
 * looking at the card is concerned, and it began with the first of them.
 */
export function useOutstandingAgentJob(threadId: string): Job | null {
  const jobs = useJobs({});
  let oldest: Job | null = null;
  for (const job of jobs.data?.jobs ?? []) {
    if (job.originId !== threadId) continue;
    if (!OUTSTANDING_STATUSES.includes(job.status)) continue;
    if (oldest === null || startedAt(job) < startedAt(oldest)) oldest = job;
  }
  return oldest;
}

/**
 * When the wait began — what `PendingIndicator` counts from.
 *
 * `Job.started` is the queue event's own `created` instant, which is the moment
 * the requesting turn was posted (the enqueue happens inside that request), right
 * up until the job writes its first log line — after which the server records
 * *that* as the job's start. Reported raw, a job that sat pending for ten minutes
 * behind other work would therefore **reset** the elapsed clock the instant the
 * agent started talking, which is the "reloading must not restart the wait" lie
 * `PendingIndicator` exists to avoid.
 *
 * The thread's newest turn bounds it. The requesting turn is a turn *of this
 * thread*, so it is never newer than the last one; taking the earlier of the two
 * therefore leaves the exact enqueue instant untouched while the job is queued
 * (it is already the earlier value) and, once the job's own start has run ahead
 * of the conversation, holds the clock at the latest instant the request could
 * possibly have been made instead of restarting it.
 */
export function agentWaitSince(job: Job, latestTurnTs: string | undefined): string {
  if (latestTurnTs === undefined) return job.started;
  const started = Date.parse(job.started);
  const latest = Date.parse(latestTurnTs);
  if (Number.isNaN(started) || Number.isNaN(latest)) return job.started;
  return latest < started ? latestTurnTs : job.started;
}
