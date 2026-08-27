import type { DocRow, Job, QueueEventStatus } from "@corpus/contract";
import { useOutstandingJobs } from "../query/useOutstandingJobs.js";

/**
 * The row signal that does **not** ride a `DocRow`: the running agent job.
 *
 * It reads through a single shared kit query — `useOutstandingJobs()` is cached
 * under one key, so a column of two hundred rows still issues one request, and
 * it repaints live because the server invalidates that key over SSE. This is the
 * reason it is not a prop drilled down from a column: a row that asks for its
 * own signals is a row any surface can render anywhere.
 *
 * There used to be a second signal here — the edit lock — and it is gone with
 * the mechanism (SPEC.md §7 "A key, not a lock"). Nothing on the board polls or
 * subscribes to lock state, because there is no lock: a document the agent is
 * writing renders exactly like any other, and the person's write presents its
 * key like any other.
 */

/**
 * The queue state that means the agent is working on this row *right now* — and
 * it is exactly one (SPEC.md §8's rider, signed 2026-08-12; UI-097).
 *
 * This used to hold `pending` as well, under a docblock claiming both meant the
 * agent was working. `pending` means the opposite: nobody has taken the event.
 * A queue of unclaimed work would spin a dot on every row it named, which is
 * the row-sized version of the "agent is working…" a person saw when no agent
 * was running at all.
 *
 * `deferred` is not here either, and for the reason it never was: it is work the
 * agent parked because a person was editing the document (SPEC.md §7). It is
 * claimed, and it is not being worked — so it reads as waiting, like anything
 * else nobody is holding. What it says *while* waiting is its own sentence since
 * UI-115; see {@link deferredRowTitle}.
 */
const WORKING_JOB_STATUS: QueueEventStatus = "in-progress";

/** The queue state that means the event exists and nobody has taken it. */
const WAITING_JOB_STATUS: QueueEventStatus = "pending";

/** …and the one that means it was taken, looked at, and put down (SPEC.md §7). */
const DEFERRED_JOB_STATUS: QueueEventStatus = "deferred";

/**
 * What a row may honestly say about the agent (SPEC.md §8).
 *
 * - `working` — an event on this row is `in-progress`: somebody claimed it and
 *   is holding it now.
 * - `waiting` — something is outstanding and **nobody is holding it**: an
 *   unclaimed event, a deferral, or a thread whose reply has not arrived where
 *   the queue's answer no longer names the job. A deferral is still `waiting`
 *   here and says something different in its title — see
 *   {@link deferredRowTitle}.
 * - `idle` — nothing outstanding, so the row says nothing.
 *
 * There is no fourth state for "outstanding, claim unknown": the honest floor is
 * `waiting`, because claiming the agent is working is the one thing §8's rider
 * forbids doing without evidence.
 */
export type AgentActivityState = "working" | "waiting" | "idle";

export interface AgentActivity {
  readonly state: AgentActivityState;
  /**
   * What is happening, for the dot's accessible label. Never a guess about
   * progress — and, on a `waiting` row, never a claim that anything started.
   */
  readonly title: string;
}

/**
 * Whether the agent owes this row something (SPEC.md §8).
 *
 * Two honest sources, no timer: `DocRow.awaitingAgent` — **the queue still owes
 * this thread something**, meaning an event in a non-terminal status carries the
 * thread's id — and the jobs projection, which names the document a queue event
 * originated from. Neither is a progress estimate, because there isn't one.
 *
 * `awaitingAgent` used to be a heuristic over thread state ("the agent was drawn
 * into an open thread and the last turn is not yet its reply"), and SERVER-054
 * replaced it with the queue predicate above. **The shape did not change**, so
 * nothing here broke and this sentence stayed false for a release
 * (CONTRACT-072). The difference that matters to a reader of this file: it reads
 * no thread state at all, so resolving a thread does not clear it — resolving
 * cancels no queued event.
 *
 * **One shared query, never one per row** (UI-069, corrected by UI-075). A row
 * hook runs once per card: a column of two hundred rows asking a
 * `["jobs", {originId}]` question each would be two hundred concurrent
 * requests, every one an unindexed scan, all refetching together on every queue
 * transition — the economics this whole module exists to avoid, and the reason
 * neither signal is a prop is that one shared key already serves every row.
 *
 * It reads `useOutstandingJobs()` rather than the console's own `useJobs({})`,
 * which is the same one-request-for-everything with a better window: the
 * console list is ordered by recency across *all* statuses, so settled churn
 * steadily pushes a long-running job out of it, while the outstanding query
 * cannot be crowded by anything that has finished. The thread card's pending row
 * shares that exact query, so a board and an open reader together still cost one
 * jobs request between them.
 *
 * Where that query is short — more unfinished events at one instant than a
 * single response carries — this row does **not** escalate to a per-row
 * question, because the second source covers exactly the case that falls out. A
 * job leaves the window by *waiting*, and a row whose thread is waiting on the
 * agent has `awaitingAgent` set by the server, which is not windowed and not a
 * scan. So the dot stays lit on the evidence that survives; what is lost is the
 * job's `lastLine` as the dot's label, and it falls back to naming the wait
 * instead. (The two sources read the same queue by different routes, which is
 * why one covering the other's gap is sound rather than lucky.)
 *
 * **Working outranks waiting** when this row has several outstanding events, and
 * only that way round: one of them being held is enough to make "the agent is
 * working on this" true, while any number of unclaimed ones is not. So the scan
 * looks for a claimed event first and settles for an unclaimed one after —
 * which is also why it is two passes over a handful rather than one pass that
 * would have to reason about order.
 */
export function useAgentActivity(row: Pick<DocRow, "id" | "awaitingAgent">): AgentActivity {
  const { jobs } = useOutstandingJobs();
  const mine = jobs.filter((candidate) => candidate.originId === row.id);
  const working = mine.find((candidate) => candidate.status === WORKING_JOB_STATUS);
  if (working !== undefined) {
    return { state: "working", title: working.lastLine ?? "Agent is working on this document" };
  }
  /*
   * **A deferral is read before an unclaimed event**, which is the precedence
   * `apps/ui`'s `pendingStateOf` uses for the thread card's own row — the two
   * must not disagree about what state a row is in (UI-115). Among the things
   * nobody is holding, a deferral is the only one whose reason is knowable and
   * whose end is in the reader's hands, so a row that said "queued — waiting to
   * be picked up" over it would hide the one fact they could act on.
   */
  const parked = mine.find((candidate) => candidate.status === DEFERRED_JOB_STATUS);
  if (parked !== undefined) {
    return { state: "waiting", title: deferredRowTitle(parked) };
  }
  if (mine.some((candidate) => candidate.status === WAITING_JOB_STATUS)) {
    return { state: "waiting", title: "Queued — waiting to be picked up" };
  }
  if (row.awaitingAgent === true) {
    return { state: "waiting", title: "Agent has not replied in this thread yet" };
  }
  return { state: "idle", title: "" };
}

/**
 * What a deferred row's dot says (SPEC.md §7; UI-115).
 *
 * Two things a bare "waiting" cannot say: that the work was **seen** rather than
 * ignored, and **what it is parked on** — because that is the one wait the
 * person reading the row can end, by finishing the edit. §7's own words: *"the
 * agent deferred because it saw, not because it was blocked."*
 *
 * The document is named from `blockedOnTitle`, then `blockedOn`, then not at
 * all. A deferral whose document the wire did not name is still a deferral, and
 * a sentence with an empty quotation in it would be worse than one clause
 * shorter (UI-098's rule: an absent answer is never presented as one).
 */
export function deferredRowTitle(job: Pick<Job, "blockedOn" | "blockedOnTitle">): string {
  const named = job.blockedOnTitle ?? job.blockedOn ?? "";
  return named === ""
    ? "Paused — the agent is waiting for an edit to finish"
    : `Paused while ${named} is being edited`;
}
