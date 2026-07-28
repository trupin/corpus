import type { ReleaseLockResult } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, LOCKS_KEY, docKey, lockKey } from "./keys.js";

/**
 * `POST /api/locks/{docId}/break` — Force unlock (SPEC.md §7).
 *
 * The human escape hatch for a stuck agent lock, and **user-only**: an agent
 * breaking its own contention would defeat the mechanism.
 *
 * Nothing here is optimistic, and the reason is the toast. The server does two
 * things a client cannot see — it records the break in the audit-trail commit
 * and it puts the agent's deferred edit back in `pending/` — so a UI that
 * cleared the banner before this resolved would be claiming both on faith. A
 * failed break (the lock was already released, the server refused) must leave
 * the banner exactly where it was.
 */
export function useBreakLock(): UseMutationResult<ReleaseLockResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ReleaseLockResult, Error, string>({
    mutationFn: (docId) => client.breakLock(docId),
    onSuccess(_result, docId) {
      void queryClient.invalidateQueries({ queryKey: lockKey(docId) });
      void queryClient.invalidateQueries({ queryKey: LOCKS_KEY });
      // The document became editable; its reader and every row showing it care.
      void queryClient.invalidateQueries({ queryKey: docKey(docId) });
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
    },
    onError() {
      // Whatever the server thinks is now the truth, not what the UI assumed.
      void queryClient.invalidateQueries({ queryKey: LOCKS_KEY });
    },
  });
}
