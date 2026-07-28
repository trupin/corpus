import type { MarkSeenResult, ThreadMutationResponse } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, docKey, threadKey } from "./keys.js";

/**
 * The two thread state flips that are not turns: resolve/reopen, and the
 * last-seen mark.
 *
 * Both write server state a client cannot derive — resolving rewrites and
 * commits the thread file (SPEC.md §6), a seen mark lands in `.corpus/seen.json`
 * and is compared against turn timestamps server-side (SPEC.md §7) — so neither
 * is optimistic. Both invalidate the thread *and* the collection, because a
 * thread is also a document row: its `status` chip and its unread badge are
 * rendered from `GET /api/docs` on every board column showing it.
 */

function invalidateThread(queryClient: QueryClient, threadId: string): void {
  void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
  // A thread is a document (`th_*`), so its own reader caches under `docKey`.
  void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
}

/** Which way the flip goes; the caller reads the current status and asks for the other. */
export interface ThreadStatusVariables {
  readonly id: string;
  /** True resolves, false reopens. */
  readonly resolved: boolean;
}

export function useSetThreadStatus(): UseMutationResult<
  ThreadMutationResponse,
  Error,
  ThreadStatusVariables
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ThreadMutationResponse, Error, ThreadStatusVariables>({
    mutationFn: ({ id, resolved }) =>
      resolved ? client.resolveThread(id) : client.reopenThread(id),
    onSuccess(_result, variables) {
      invalidateThread(queryClient, variables.id);
    },
  });
}

/**
 * `POST /api/threads/{id}/seen`.
 *
 * Callers are surfaces that *displayed* a thread — SPEC.md §7's rule is
 * displayed content only, and opening a parent document is explicitly not that.
 */
export function useMarkThreadSeen(): UseMutationResult<MarkSeenResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<MarkSeenResult, Error, string>({
    mutationFn: (id) => client.markThreadSeen(id),
    onSuccess(_result, id) {
      invalidateThread(queryClient, id);
    },
  });
}
