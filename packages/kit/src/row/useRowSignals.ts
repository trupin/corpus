import type { DocRow, Lock, QueueEventStatus } from "@corpus/contract";
import { useOutstandingJobs } from "../query/useOutstandingJobs.js";
import { useLocks } from "../query/useLocks.js";

/**
 * The two row signals that do **not** ride a `DocRow`: the edit lock and the
 * running agent job.
 *
 * Both read through a single shared kit query — `useLocks()` and
 * `useOutstandingJobs()` are cached under one key each, so a column of two
 * hundred rows still issues one request for each, and both repaint live because
 * the server invalidates those keys over SSE. This is the reason neither is a
 * prop drilled down from a column: a row that asks for its own lock is a row a
 * plugin can render anywhere.
 */

/**
 * Queue states that mean the agent is working on this row *right now*.
 *
 * Narrower than the shared query's `OUTSTANDING_JOB_STATUSES` on purpose:
 * `deferred` is work parked on someone else's edit lock, and a spinning dot on
 * every row of a corpus whose lock is held would say the agent is busy with each
 * of them. The wait is still reported — by `awaitingAgent`, below.
 */
const ACTIVE_JOB_STATUSES: readonly QueueEventStatus[] = ["pending", "in-progress"];

/** The lock held on this document, or `null`. Live over SSE (SPEC.md §7). */
export function useDocLock(docId: string): Lock | null {
  const locks = useLocks();
  return locks.data?.locks.find((lock) => lock.docId === docId) ?? null;
}

export interface AgentActivity {
  readonly active: boolean;
  /** What is running, for the dot's accessible label. Never a guess about progress. */
  readonly title: string;
}

/**
 * Whether the agent owes this row something (SPEC.md §8).
 *
 * Two honest sources, no timer: `DocRow.awaitingAgent` — the agent was drawn
 * into an open thread and the last turn is not yet its reply — and the jobs
 * projection, which names the document a queue event originated from. Neither is
 * a progress estimate, because there isn't one.
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
 * instead.
 */
export function useAgentActivity(row: Pick<DocRow, "id" | "awaitingAgent">): AgentActivity {
  const { jobs } = useOutstandingJobs();
  const job = jobs.find(
    (candidate) => candidate.originId === row.id && ACTIVE_JOB_STATUSES.includes(candidate.status),
  );
  if (job !== undefined) {
    return { active: true, title: job.lastLine ?? `Agent job ${job.status} on this document` };
  }
  if (row.awaitingAgent === true) {
    return { active: true, title: "Agent has not replied in this thread yet" };
  }
  return { active: false, title: "" };
}
