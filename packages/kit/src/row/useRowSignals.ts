import type { DocRow, Lock, QueueEventStatus } from "@corpus/contract";
import { useJobs } from "../query/useJobs.js";
import { useLocks } from "../query/useLocks.js";

/**
 * The two row signals that do **not** ride a `DocRow`: the edit lock and the
 * running agent job.
 *
 * Both read through a single shared kit query — `useLocks()` and `useJobs()` are
 * cached under one key each, so a column of two hundred rows still issues one
 * request for each, and both repaint live because the server invalidates those
 * keys over SSE. This is the reason neither is a prop drilled down from a
 * column: a row that asks for its own lock is a row a plugin can render
 * anywhere.
 */

/** Queue states that mean work is genuinely outstanding right now. */
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
 */
export function useAgentActivity(row: Pick<DocRow, "id" | "awaitingAgent">): AgentActivity {
  const jobs = useJobs({});
  const job = jobs.data?.jobs.find(
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
