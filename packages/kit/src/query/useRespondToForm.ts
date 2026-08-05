import type { FormAnswerResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { FormAnswerInput } from "../client/createCorpusClient.js";
import { DOCS_KEY, docKey, JOBS_KEY, QUEUE_KEY, threadKey } from "./keys.js";

/**
 * `POST /api/threads/{id}/turns/{ts}/form` — answering the form in an agent turn
 * (SPEC.md §6).
 *
 * **This route, never a hand-built turn.** The server is what validates the
 * option against the fence, writes the structured answer turn *and* enqueues the
 * `form.respond` event that re-triggers the agent (SPEC.md §8). A UI that
 * composed the answer itself and posted it to `/turns` would produce a
 * convincing-looking conversation and no event at all — a failure invisible
 * until someone reads `.corpus/queue/pending/`.
 *
 * Not optimistic: the answer turn's body and timestamp are the server's, and an
 * answer the server rejects (an option this form does not offer, a form already
 * answered from another tab) must not appear to have landed.
 */
export type FormAnswerVariables = FormAnswerInput;

export function useRespondToForm(
  threadId: string,
): UseMutationResult<FormAnswerResponse, Error, FormAnswerVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<FormAnswerResponse, Error, FormAnswerVariables>({
    mutationFn: (variables) => client.respondToForm(threadId, variables),
    onSuccess(data) {
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
      // The thread leaves `needs=form`, which is a row-level attention reason.
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      // An answer re-triggers the agent (SPEC.md §8), and the `form.respond` job
      // it enqueued is what the thread's pending row reads (UI-058).
      if (data.eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
        void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      }
    },
  });
}
