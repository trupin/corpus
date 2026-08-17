import type { ThreadMutationResponse } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { AGENTS_KEY, DOCS_KEY, docKey, threadKey } from "./keys.js";
import type { SettledCallbacks } from "./settledCallbacks.js";

/**
 * Designating and releasing a thread's resident — SPEC.md §7's *"Designation is
 * user-only state on the thread, set and released like any other thread
 * field"*, as one mutation with a direction.
 *
 * ## One hook, because it is one field
 *
 * `resident` is single-valued and dissolution is its **absence, never a third
 * state**. Two hooks would be two places to keep the invalidation set in step,
 * and the set is the interesting part: designating rewrites the thread's
 * frontmatter and auto-commits (§4), enqueues `resident.designated`, and — the
 * one a caller forgets — **changes the roster**, because the lane a designation
 * creates is exactly a row of `GET /api/agents`. A designation that did not
 * invalidate {@link AGENTS_KEY} would land on disk and leave the composer
 * offering a lane list that does not contain it.
 *
 * ## Not optimistic, deliberately
 *
 * The name a person picks is resolved server-side against the workspace's
 * `type: agent-def` documents (§8's `@<subagent>` resolution), so the response
 * carries a `{name, docId}` this client could not have computed — and a name
 * that resolves to nothing is a `404`. There is nothing honest to paint before
 * the answer arrives.
 */

function invalidateResident(queryClient: QueryClient, threadId: string): void {
  void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
  void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
}

/** Which way the designation goes; `name` is absent for a release. */
export interface ResidentVariables {
  readonly id: string;
  /**
   * The agent's **invocable name** — what `@<subagent>` would have written, not
   * a document id. `undefined` releases whoever is resident.
   */
  readonly name?: string | undefined;
}

/**
 * `callbacks` are teardown-safe ({@link SettledCallbacks}), for the reason
 * `useSetThreadStatus` states: the menu that designates closes in the same
 * click, so a per-call `onSuccess` would be dropped with the observer and the
 * write would land without a word (UI-012, UI-015).
 */
export function useSetResident(
  callbacks: SettledCallbacks<ThreadMutationResponse, ResidentVariables> = {},
): UseMutationResult<ThreadMutationResponse, Error, ResidentVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<ThreadMutationResponse, Error, ResidentVariables>({
    mutationFn: ({ id, name }) =>
      name === undefined ? client.releaseResident(id) : client.designateResident(id, name),
    onSuccess(result, variables) {
      invalidateResident(queryClient, variables.id);
      onSuccess?.(result, variables);
    },
    onError(error, variables) {
      onError?.(error, variables);
    },
  });
}
