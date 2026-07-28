import type { CreateThreadResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { CreateThreadInput } from "../client/createCorpusClient.js";
import { DOCS_KEY, docKey, QUEUE_KEY, threadKey } from "./keys.js";

/**
 * `POST /api/threads` — the JSON form (SPEC.md §6). Attachments are multipart
 * and are a later issue's surface.
 *
 * A created thread is a new document, a new row in every list that matches it,
 * and — when the first turn draws the agent in — a new queue event, so all four
 * key families are invalidated. `parent`'s own key is invalidated too: an
 * anchored thread rewrites the parent's frontmatter anchors map.
 */
export function useCreateThread(): UseMutationResult<
  CreateThreadResponse,
  Error,
  CreateThreadInput
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<CreateThreadResponse, Error, CreateThreadInput>({
    mutationFn: (input) => client.createThread(input),
    onSuccess(data, variables) {
      void queryClient.invalidateQueries({ queryKey: threadKey(data.thread.id) });
      if (variables.parent !== undefined && variables.parent !== null) {
        void queryClient.invalidateQueries({ queryKey: docKey(variables.parent) });
      }
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      if (data.eventId !== null) void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}
