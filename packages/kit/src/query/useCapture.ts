import type { CaptureResult } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { CaptureInput } from "../client/createCorpusClient.js";
import { DOCS_KEY, QUEUE_KEY, TREE_KEY } from "./keys.js";

/**
 * `POST /api/capture` — the global composer's *Capture* (SPEC.md §11).
 *
 * **One call, because it is one act.** The server creates the document in
 * `data/docs/inbox/`, the agent-requested whole-document filing thread that asks
 * for it to be retitled, moved, expanded and tagged, and the `comment.created`
 * event that wakes the agent — atomically, in one commit. Composing that in the
 * client from `useCreateDoc` + `useCreateThread` is three round trips, two of
 * which can fail after the first has already written a file.
 *
 * Two documents appear (the capture and its thread) and a job is enqueued, so
 * the document, tree and queue key families are all invalidated. Not optimistic,
 * for the reason `useCreateDoc` states: the id, path, title and timestamps are
 * the server's, and the result carries ids rather than rows — a row assembled
 * here would be a document the corpus has never heard of.
 */
export function useCapture(): UseMutationResult<CaptureResult, Error, CaptureInput> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<CaptureResult, Error, CaptureInput>({
    mutationFn: (input) => client.capture(input),
    onSuccess(data) {
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      if (data.eventId !== null) void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}
