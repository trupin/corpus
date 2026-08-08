import type { BodyRange, ReattachThreadResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, docKey, threadKey } from "./keys.js";
import type { SettledCallbacks } from "./settledCallbacks.js";

/**
 * `POST /api/threads/{id}/reattach` — a person pointing an orphaned comment at
 * the passage it was always about (SPEC.md §6; SERVER-059 phase B).
 *
 * **The range travels, never a candidate index.** The UI generates the sites it
 * offers; the server regenerates nothing and counts into nothing. If it did, a
 * list that had shifted by one between rendering and clicking would attach the
 * comment to a different passage with no way for anybody to notice — the exact
 * silent misattachment this route exists to end (CONTRACT-041).
 *
 * **Not optimistic.** The write can be refused by three different states of the
 * document (`range-changed`, `range-overlaps`, `not-anchored`), and a repair
 * shown as done and then quietly undone is worse than one that took a beat: the
 * whole point of the affordance is that the person can trust where the comment
 * landed.
 */
export interface ReattachThreadVariables {
  readonly id: string;
  /**
   * The parent document whose `anchors` map the repair rewrites.
   *
   * Carried by the caller rather than read off the response so the parent's
   * reader is invalidated even when the call *fails* — a `range-changed`
   * refusal means the caller is looking at stale bytes, and the next thing it
   * needs is the current ones.
   */
  readonly parentId: string;
  readonly range: BodyRange;
  /** The bytes the person saw at `range`; a guard the server never stores. */
  readonly expectedText: string;
}

export function useReattachThread(
  callbacks: SettledCallbacks<ReattachThreadResponse, ReattachThreadVariables> = {},
): UseMutationResult<ReattachThreadResponse, Error, ReattachThreadVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<ReattachThreadResponse, Error, ReattachThreadVariables>({
    mutationFn: ({ id, range, expectedText }) => client.reattachThread(id, { range, expectedText }),
    onSuccess(result, variables) {
      // The same three keys the server announces over SSE — the thread's own
      // record, the parent whose anchors moved, and every list that renders a
      // thread row. Invalidating here as well is what makes the orphan leave the
      // detached section on the click rather than on the frame the event lands.
      void queryClient.invalidateQueries({ queryKey: threadKey(variables.id) });
      void queryClient.invalidateQueries({ queryKey: docKey(variables.id) });
      void queryClient.invalidateQueries({ queryKey: docKey(variables.parentId) });
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      onSuccess?.(result, variables);
    },
    onError(error, variables) {
      // A refusal is almost always the document having moved under the person,
      // so the parent is re-read before they are asked to choose again.
      void queryClient.invalidateQueries({ queryKey: docKey(variables.parentId) });
      onError?.(error, variables);
    },
  });
}
