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
 *
 * **This one keeps the shared `useJobs({})` query on purpose** (UI-069). The
 * thread reader's equivalent now asks a filtered query per thread, because its
 * answer had to be complete and there is one reader per open column. A *row*
 * runs once per card: a column of two hundred rows would issue two hundred
 * requests for two hundred distinct `["jobs", {originId}]` keys, which is the
 * economics this whole module exists to avoid — the reason neither signal is a
 * prop drilled down from a column is that one shared key serves every row.
 *
 * The console window that costs the thread reader its honesty costs this row
 * much less, because the second source covers exactly the case that falls out of
 * it. A job sinks below the cut-off by *waiting* — deferred on an edit lock, or
 * queued behind a backlog — and a row whose thread is waiting on the agent has
 * `awaitingAgent` set by the server, which is not windowed and not a scan. So the
 * dot stays lit on the evidence that survives; what is lost is the job's
 * `lastLine` as the dot's label, and it falls back to naming the wait instead.
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
