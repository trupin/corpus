import type { DesignateResidentRequest, ThreadMutationResponse } from "@corpus/contract";
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
 *
 * A **general** designation is the one case a client could have predicted the
 * answer to — `{name: null, docId: null}` needs no lookup — and it is not
 * painted either. It is one round trip on a thread the person is looking at, and
 * a hook with two write paths, one optimistic, would be two behaviours to keep
 * honest for a saving nobody can perceive.
 *
 * ## The weight rides the same write, because it is the same act
 *
 * SPEC.md §7's rider signed 2026-08-19 makes the designation the **only** place
 * a resident's level is chosen — a running agent cannot change what it is
 * without discarding the conversation it holds — so `weight` is a field of
 * {@link ResidentVariables} and not a second mutation. Until UI-168 this hook
 * had no such field, and the consequence was total: the contract carried it, the
 * server honoured it and `corpus resident` set it, while **every designation the
 * app ever made sent no weight at all**.
 */

function invalidateResident(queryClient: QueryClient, threadId: string): void {
  void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
  void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
}

/**
 * Which way the designation goes, **spelled rather than inferred from an absent
 * field**.
 *
 * It used to be `{id, name?}`, where no name meant a release. SHARED-048 took
 * that spelling away: a designation may now name **no** profile, so "no name" is
 * two different acts — designate a general resident, and dissolve the
 * designation — and the two would have been one `undefined` apart, with the
 * wrong one silently dropping a resident somebody had chosen. `designate: null`
 * is the general one and `release` is the other, and neither can be reached by
 * forgetting to set a variable.
 */
export type ResidentVariables =
  | {
      readonly id: string;
      /**
       * The agent's **invocable name** — what `@<subagent>` would have written,
       * not a document id — or `null` for §7's general resident, which names no
       * profile at all.
       */
      readonly designate: string | null;
      /**
       * The level the resident runs at — a key from the workspace's own tier
       * table (`weightLevels.ts`), never a model name (CONTRACT-067; SPEC.md
       * §7's rider signed 2026-08-19, which makes the designation the only place
       * the choice exists).
       *
       * **Omitted is the ordinary case and the only spelling of it.** Absence
       * means what it meant before the field existed — the launcher decides, and
       * `Resident.weight` reads null — so this hook drops the key from the body
       * rather than sending `null`, which the route refuses, or `""`, which is a
       * `400`. It is `string | undefined` rather than plainly optional so a
       * caller holding "nothing chosen" in a variable can pass it straight
       * through under `exactOptionalPropertyTypes`; the omission happens once,
       * below, and not at every call site.
       *
       * Independent of `designate`: a general resident may run at a stated
       * level, and a profiled one at none.
       */
      readonly weight?: string | undefined;
    }
  | { readonly id: string; readonly release: true };

/**
 * The request body a designation sends — **the key absent, never null**.
 *
 * The one seam between this hook's spelling of "no profile" (`designate: null`)
 * and the route's (the key is not there), and between "no level chosen"
 * (`weight: undefined`) and the same. Both are built by omission rather than by
 * assignment, because `exactOptionalPropertyTypes` is what makes
 * `{ weight: undefined }` a different object from `{}` here and only one of them
 * survives `JSON.stringify` as nothing at all.
 */
function designationBody(variables: {
  readonly designate: string | null;
  readonly weight?: string | undefined;
}): DesignateResidentRequest {
  return {
    ...(variables.designate === null ? {} : { name: variables.designate }),
    ...(variables.weight === undefined ? {} : { weight: variables.weight }),
  };
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
    mutationFn: (variables) =>
      "release" in variables
        ? client.releaseResident(variables.id)
        : client.designateResident(variables.id, designationBody(variables)),
    onSuccess(result, variables) {
      invalidateResident(queryClient, variables.id);
      onSuccess?.(result, variables);
    },
    onError(error, variables) {
      onError?.(error, variables);
    },
  });
}
