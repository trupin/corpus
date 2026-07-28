import type { Lock, ReleaseLockResult } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { LOCKS_KEY, lockKey } from "./keys.js";

/**
 * The **user side** of SPEC.md §7's edit lock: take it while typing, give it
 * back when done.
 *
 * The kit already had the read (`useLocks` / `useDocLock`) and the escape hatch
 * (`useBreakLock`), which is everything a surface needs to *react* to somebody
 * else editing. What was missing is the half that makes the other direction
 * work: "the user's editor session holds the lock while actively editing
 * (acquired via the server on first keystroke, released on idle/close); the
 * orchestrator defers edits to user-locked documents". Nothing acquired one, so
 * nothing was ever deferred.
 *
 * Neither hook is optimistic. A lock is contention state the server arbitrates
 * — a client that wrote "I hold it" into the cache before the server agreed
 * would show an editable document to a user whose request had just been refused
 * with a `409`.
 */

function invalidateLocks(queryClient: QueryClient, docId: string): void {
  void queryClient.invalidateQueries({ queryKey: lockKey(docId) });
  void queryClient.invalidateQueries({ queryKey: LOCKS_KEY });
}

/** Which document to lock, and for how long. */
export interface AcquireLockVariables {
  readonly docId: string;
  /** Lease in seconds; omitted takes the server's default (300 s). */
  readonly ttlSeconds?: number;
}

/**
 * `POST /api/locks/{docId}` — take the lock, or renew a lease already held.
 *
 * The renewal case is the heartbeat: an editing session re-acquires well inside
 * the TTL so a long silent pause does not let the reaper hand the document to
 * the agent mid-paragraph, while a browser that crashes still frees it.
 *
 * A `409` means the other party holds it. That is not an error state for the
 * caller to report — the document is already read-only behind a lock banner
 * that says who has it — so callers are expected to swallow it.
 */
export function useAcquireLock(): UseMutationResult<Lock, Error, AcquireLockVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<Lock, Error, AcquireLockVariables>({
    mutationFn: ({ docId, ttlSeconds }) => client.acquireLock(docId, ttlSeconds),
    onSuccess(_lock, { docId }) {
      invalidateLocks(queryClient, docId);
    },
    onError(_error, { docId }) {
      // The refusal carries the winning lock; refetching is how the banner
      // learns who took it.
      invalidateLocks(queryClient, docId);
    },
  });
}

/**
 * `DELETE /api/locks/{docId}` — release a lock this session holds.
 *
 * Called on blur, on idle and on unmount. A release that fails because the lock
 * was already gone (broken, reaped, released twice) is not a problem worth
 * reporting: the desired end state — no lock — is the state that exists.
 */
export function useReleaseLock(): UseMutationResult<ReleaseLockResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ReleaseLockResult, Error, string>({
    mutationFn: (docId) => client.releaseLock(docId),
    onSettled(_result, _error, docId) {
      invalidateLocks(queryClient, docId);
    },
  });
}
