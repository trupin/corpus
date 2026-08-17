import type { CreateThreadResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { CreateThreadInput } from "../client/createCorpusClient.js";
import { DOCS_KEY, docKey, JOBS_KEY, QUEUE_KEY, threadKey } from "./keys.js";
import type { SettledCallbacks } from "./settledCallbacks.js";

/**
 * `POST /api/threads` (SPEC.md §6, §8) — an anchored comment, a whole-document
 * comment, or the global composer's standalone *Ask*.
 *
 * A created thread is a new document, a new row in every list that matches it,
 * and — when the first turn draws the agent in — a new queue event, so all four
 * key families are invalidated. `parent`'s own key is invalidated too: an
 * anchored thread rewrites the parent's frontmatter anchors map.
 *
 * **Attachments switch the request, not the hook** (SPEC.md §6). A non-empty
 * `files` sends `multipart/form-data` through `createThreadWithFiles`;
 * everything else is the JSON body. That is exactly the branch `useAppendTurn`
 * makes, in the same place, so a composer attaching a screenshot to a first turn
 * calls one hook rather than choosing between two.
 *
 * Deliberately **not optimistic**, unlike a turn append: the server assigns the
 * thread's id, path and timestamps, and a row written from the request would be
 * a different document from the one on disk (see `useCreateDoc`). The row
 * arrives on the invalidation below, which refetches every active list at once.
 */

export interface CreateThreadVariables extends CreateThreadInput {
  /**
   * Attachments for the first turn (SPEC.md §6). Present and non-empty switches
   * the request to multipart; a first turn carrying files may have an empty
   * `body`.
   */
  readonly files?: readonly File[] | undefined;
}

/**
 * `callbacks` are teardown-safe (see {@link SettledCallbacks}) — the same
 * contract `useUpdateDoc` states, kept here so `useRowActions` can report all
 * three of its acts the same way (UI-012).
 */
export function useCreateThread(
  callbacks: SettledCallbacks<CreateThreadResponse, CreateThreadVariables> = {},
): UseMutationResult<CreateThreadResponse, Error, CreateThreadVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<CreateThreadResponse, Error, CreateThreadVariables>({
    mutationFn: (input) => {
      const files = input.files ?? [];
      if (files.length === 0) {
        const { files: _unused, ...json } = input;
        return client.createThread(json);
      }
      const selector = input.selector;
      return client.createThreadWithFiles({
        ...(input.parent === undefined || input.parent === null ? {} : { parent: input.parent }),
        ...(selector === undefined || selector === null
          ? {}
          : {
              selector: {
                exact: selector.exact,
                ...(selector.prefix === undefined ? {} : { prefix: selector.prefix }),
                ...(selector.suffix === undefined ? {} : { suffix: selector.suffix }),
              },
            }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === "" ? {} : { text: input.body }),
        ...(input.requestsAgent === undefined ? {} : { requestsAgent: input.requestsAgent }),
        // The stated weight rides on the multipart branch too (SPEC.md §11
        // names a comment carrying a file among the surfaces that may state
        // one), so attaching a file cannot silently drop it.
        ...(input.weight === undefined ? {} : { weight: input.weight }),
        // SPEC.md §7's recipient rides the multipart branch too: a summons that
        // survived only the JSON path would be dropped by attaching a file.
        ...(input.recipient === undefined ? {} : { recipient: input.recipient }),
        files,
      });
    },
    onSuccess(data, variables) {
      void queryClient.invalidateQueries({ queryKey: threadKey(data.thread.id) });
      if (variables.parent !== undefined && variables.parent !== null) {
        void queryClient.invalidateQueries({ queryKey: docKey(variables.parent) });
      }
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      if (data.eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
        // The job the enqueue created is what the new thread's pending row reads
        // (SPEC.md §8, UI-058), not just a number in the console strip.
        void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      }
      onSuccess?.(data, variables);
    },
    onError(error, variables) {
      onError?.(error, variables);
    },
  });
}
