import type { Job } from "@corpus/contract";
import {
  OUTSTANDING_JOB_STATUSES,
  OUTSTANDING_JOB_STATUS_PARAM,
  useJobs,
  useOutstandingJobs,
} from "@corpus/kit";
import { useState } from "react";

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
 * §7, §10). That is a fact the server maintains rather than an inference from who
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
 * wait indefinitely while a person is editing (SPEC.md §7) — and a `pending`
 * job behind a long backlog
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
 * thread, which is SPEC.md §10's placement for focus mode and wide readers, and
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
 * The outstanding request a thread card reports: **one wait, and who is holding
 * it** (SPEC.md §8's rider, signed 2026-08-12; UI-097).
 *
 * Two fields rather than one job, because the two questions have different
 * answers when a thread has several events outstanding — and it is an ordinary
 * shape, not a corner: ask twice while the agent is slow and there are two.
 *
 * - `job` is the **oldest**, and it is what the clock counts from. Two queued
 *   events are one wait as far as the person reading the card is concerned, and
 *   it began with the first of them ({@link pickOutstandingJob}).
 * - `working` is true when **any** of them is `in-progress`, which is the
 *   direction that makes the claim true: one event being held is enough for
 *   "the agent is working on this thread", while any number of unclaimed ones is
 *   not. So a thread that asked twice, was answered once and is being worked
 *   reads as working, counting from the first ask — which is exactly the state
 *   the person is in.
 *
 * **`deferred` is `working: false`, and since UI-115 it is more than that.** It
 * was claimed and then parked because somebody is editing the document it needs
 * (SPEC.md §7): the reply is still coming, so it stays outstanding, but nobody
 * is working it this minute and the row must not say otherwise. UI-097 left it
 * folded into "waiting", which is true and invites a false inference — *nothing
 * is happening and nobody has looked* — when in fact something looked, and it is
 * waiting on **the person reading the row**. So it is reported as its own state,
 * carrying the document it is parked on.
 */
export interface OutstandingAgentRequest {
  /** The oldest unfinished job on this thread — the one the clock runs from. */
  readonly job: Job;
  /** Whether some unfinished job on this thread has actually been claimed. */
  readonly working: boolean;
  /**
   * Where a **parked** request is parked, or `null` when nothing is parked.
   *
   * Non-null only while `working` is false: a thread with something genuinely
   * in flight is being worked, whatever else is queued behind it.
   */
  readonly deferred: DeferredOn | null;
}

/**
 * The document a deferral is waiting on — `Job.blockedOn` and its title
 * (SPEC.md §7, CONTRACT-021).
 *
 * The title is the denormalised copy the server reads at response time, and it
 * is `null` for a document that no longer exists — so the wording has to survive
 * an unnamed document rather than printing an empty quotation.
 */
export interface DeferredOn {
  /** The document the agent is waiting on, or `null` off-contract. */
  readonly docId: string | null;
  readonly title: string | null;
}

/**
 * What to call the document a deferral is parked on, or `null` when it cannot be
 * called anything.
 *
 * The title, then the id, then nothing. The id is a poor name and a true one —
 * it is what every other surface falls back to — while a `null` here is what
 * makes the wording drop the clause instead of printing an empty quotation
 * (UI-098's rule: an absent answer is never presented as one).
 */
export function deferredOnName(deferred: DeferredOn): string | null {
  if (deferred.title !== null && deferred.title !== "") return deferred.title;
  return deferred.docId !== null && deferred.docId !== "" ? deferred.docId : null;
}

/**
 * What a thread's outstanding work **is**, in the one vocabulary every surface
 * that reports it shares (SPEC.md §8; UI-097, extended by UI-115).
 *
 * - `working` — something on this thread is `in-progress`. Somebody claimed it
 *   and is holding it now.
 * - `deferred` — something was claimed, looked at, and **put down on purpose**
 *   because a person is editing the document it needs. §7 is emphatic that this
 *   is not a failure: *"Nothing refused it: the agent deferred because it saw,
 *   not because it was blocked."*
 * - `waiting` — outstanding and nobody is holding it.
 */
export type PendingState = "working" | "deferred" | "waiting";

/**
 * Which of the three this request is in.
 *
 * **`deferred` outranks `waiting`, and `working` outranks both.** A thread can
 * hold several events at once, so a precedence is needed rather than a lookup,
 * and this one is chosen twice over: one claimed event is enough to make "the
 * agent is working on this" true, and among the unclaimed ones a deferral is the
 * only state whose reason is knowable *and* clearable by the person reading it.
 * A row that said "queued — waiting to be picked up" while a deferral sat behind
 * it would hide the one fact they could act on.
 *
 * `packages/kit/src/row/useRowSignals.ts` applies the same precedence for the
 * board row's dot, so the two surfaces cannot disagree about what state a row is
 * in.
 */
export function pendingStateOf(request: OutstandingAgentRequest): PendingState {
  if (request.working) return "working";
  return request.deferred === null ? "waiting" : "deferred";
}

/**
 * {@link pickOutstandingJob} plus the claim question, over one list.
 *
 * Separate from the pick so the oldest-wins rule and the any-claimed rule stay
 * legible as the two different rules they are: one is about *when* the wait
 * started and the other about *what is happening to it now*, and folding them
 * into a single scan would make the second look like a property of the job the
 * first chose. It is not — the oldest job may be the pending one while a later
 * ask is being worked.
 */
export function pickOutstandingRequest(
  jobs: readonly Job[],
  threadId: string,
): OutstandingAgentRequest | null {
  const job = pickOutstandingJob(jobs, threadId);
  if (job === null) return null;
  const mine = jobs.filter((candidate) => candidate.originId === threadId);
  const working = mine.some((candidate) => candidate.status === "in-progress");
  /*
   * The oldest deferral, for the same reason the clock takes the oldest job: two
   * parked events are one pause as far as the person reading the card is
   * concerned, and it began with the first of them. `blockedOn` is `null` only
   * off-contract (CONTRACT-021 makes it non-null exactly when `status` is
   * `deferred`), and a deferral that names no document is still a deferral —
   * `PendingIndicator` has a sentence for it that names no document either,
   * rather than this reading dropping it back into "waiting".
   */
  let parked: Job | null = null;
  if (!working) {
    for (const candidate of mine) {
      if (candidate.status !== "deferred") continue;
      if (parked === null || startedAt(candidate) < startedAt(parked)) parked = candidate;
    }
  }
  const deferred =
    parked === null ? null : { docId: parked.blockedOn, title: parked.blockedOnTitle };
  return { job, working, deferred };
}

/**
 * When the escalation currently in progress began, or `null` when there is none.
 *
 * A `truncated` shared answer is not one continuous state: the queue saturates,
 * drains, and saturates again, and each of those is a **separate question** to
 * the server even though the cache key is the same both times. This is the
 * boundary between them, read during render rather than from an effect so the
 * very first render of a new episode already knows it is a new one — the render
 * on which the parked query still holds the previous episode's answer, and the
 * only render on which preferring it would matter.
 *
 * `Date.now()` in the state initialiser rather than `null` for a hook that mounts
 * mid-episode: an answer cached before this card existed is an answer to a
 * question nobody here asked, and disregarding it costs at most one repaint of
 * the shared reading.
 */
interface Escalation {
  readonly escalated: boolean;
  readonly since: number | null;
}

function useEscalationStart(escalated: boolean): number | null {
  const [episode, setEpisode] = useState<Escalation>(() => ({
    escalated,
    since: escalated ? Date.now() : null,
  }));
  if (episode.escalated !== escalated) {
    // React's "adjusting state during render": the output of this pass is
    // discarded and the component re-renders immediately with the new episode,
    // so no effect ordering can put a stale answer on the screen first.
    const started: Escalation = { escalated, since: escalated ? Date.now() : null };
    setEpisode(started);
    return started.since;
  }
  return episode.since;
}

/**
 * The outstanding request this thread is waiting on, or `null` — the oldest
 * unfinished job, and whether anything on this thread has been claimed.
 *
 * **One request for every card on the screen, and a complete answer anyway.**
 * The ordinary read is the shared outstanding query — one cache entry for the
 * whole app, whatever the document's comment count — and the per-thread
 * `?originId=` question is issued only while that answer reports itself
 * possibly short, which takes `MAX_RECENT_JOBS` events unfinished at the same
 * instant.
 *
 * **The escalation's answer is read only while it answers *this* escalation**
 * (UI-076). Parking the query does not empty it: TanStack keeps the last
 * response, and under `staleTime: Infinity` (`app/queryClient.ts`) it keeps it
 * indefinitely. So the second time the queue saturates, the query is re-enabled
 * already holding the **first** episode's answer — "job X is outstanding", true
 * when it was fetched, about a job that finished while the queue was draining —
 * and a caller that preferred whatever data was in hand would put "working…" on
 * the card for work that is not happening, until the re-enable refetch lands.
 * That is the pending row UI-058 and UI-069 were each filed to remove, so the
 * cached answer counts only when it arrived no earlier than the escalation
 * asking now: `dataUpdatedAt` against {@link useEscalationStart}.
 *
 * **Until it arrives the shared list answers, and that can under-report** — a
 * job buried past the cap reads as no job at all for the one round trip the
 * exact question takes. That is the direction to fail in, and it is not a new
 * one: it is exactly what the *first* escalation does, having no cached answer
 * to prefer. A card that has not yet said "working…" is corrected by the next
 * repaint; a card counting up a wait for a job that finished minutes ago is a
 * claim the person reading it has no way to check.
 *
 * The comparison is against the escalation's start and not against the shared
 * query's own `dataUpdatedAt`, which would be simpler and wrong: within one
 * episode both queries refetch on every `["jobs"]` invalidation, and requiring
 * the exact answer to be the newer of the two would drop the card back to the
 * shared reading — which is short, that being the premise — on every queue
 * transition. A saturated queue transitions constantly, so the pending row would
 * flicker on and off throughout the wait it is reporting.
 */
export function useOutstandingAgentRequest(threadId: string): OutstandingAgentRequest | null {
  const outstanding = useOutstandingJobs();
  const exact = useJobs(
    { originId: threadId, status: OUTSTANDING_JOB_STATUS_PARAM },
    { enabled: outstanding.truncated },
  );
  const escalatedAt = useEscalationStart(outstanding.truncated);
  const answer =
    escalatedAt !== null && exact.dataUpdatedAt >= escalatedAt ? exact.data : undefined;
  return pickOutstandingRequest(answer?.jobs ?? outstanding.jobs, threadId);
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
