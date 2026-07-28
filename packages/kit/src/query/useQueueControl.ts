import type { Job, QueueStatus } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "./keys.js";

/**
 * The console's four write actions (SPEC.md §7, §11): halt, resume, retry a
 * failed job, abandon one. None is optimistic — the halted flag and a job's
 * status are the *server's* answer, read back from `GET /api/queue/status` and
 * `GET /api/jobs`, and a console that drew its own conclusion would be the one
 * surface in the product that could disagree with `.corpus/HALT` on disk.
 *
 * ## Why the document collection is invalidated here
 *
 * A **failed job is an Attention reason** — the server's own `failed-job` code,
 * computed in SQL from `events.status = 'failed'` joined to the document the
 * event's payload names (SPEC.md §11). Retrying or abandoning a job therefore
 * changes which rows `?needs=me` returns.
 *
 * The server's queue transitions announce `["queue"]` and `["jobs"]` and **not**
 * `["docs"]`, so nothing on the wire tells the Attention column that its rows
 * changed. Naming `DOCS_KEY` here is what makes the Attention row clear the
 * instant the user presses Retry, rather than at the next unrelated document
 * write. It is a real coupling — the queue is an input to a document query —
 * and it is written down rather than left to a blanket `invalidateQueries()`.
 */

/**
 * Everything a queue/job transition can make stale, in one place.
 *
 * `JOBS_KEY` is `["jobs"]` and a log query is `["jobs", eventId]`, so the second
 * call covers the list *and* every job's log by prefix — the same reach the
 * server's own frame has. Naming the log key separately would only restate it.
 */
function invalidateQueue(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
  // See the module docblock: `failed-job` is an Attention reason, so the
  // collection query is downstream of the queue even though no frame says so.
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
}

/** `POST /api/queue/halt` — writes `.corpus/HALT`; the reason is optional. */
export function useHaltQueue(): UseMutationResult<QueueStatus, Error, string | undefined> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<QueueStatus, Error, string | undefined>({
    mutationFn: (reason) => client.haltQueue(reason),
    onSuccess() {
      invalidateQueue(queryClient);
    },
  });
}

/** `POST /api/queue/resume` — removes the sentinel; parked claims go live. */
export function useResumeQueue(): UseMutationResult<QueueStatus, Error, void> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<QueueStatus, Error, void>({
    mutationFn: () => client.resumeQueue(),
    onSuccess() {
      invalidateQueue(queryClient);
    },
  });
}

/** `POST /api/jobs/{id}/retry` — the failed-job action in the detail header. */
export function useRetryJob(): UseMutationResult<Job, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<Job, Error, string>({
    mutationFn: (eventId) => client.retryJob(eventId),
    onSuccess() {
      invalidateQueue(queryClient);
    },
  });
}

/** `POST /api/jobs/{id}/abandon` — the other half. Nothing is deleted. */
export function useAbandonJob(): UseMutationResult<Job, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<Job, Error, string>({
    mutationFn: (eventId) => client.abandonJob(eventId),
    onSuccess() {
      invalidateQueue(queryClient);
    },
  });
}
