import type { ReflectAskResult, ReflectStatus } from "@corpus/contract";
import { JOBS_KEY, QUEUE_KEY, REFLECT_KEY, useCorpusClient } from "@corpus/kit";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

/**
 * The reflection clock, and the ask (SPEC.md §7, rider 9).
 *
 * ## No poller, and one subscription for both halves
 *
 * `GET /api/workspace/reflect` moves on two unrelated things — a document write
 * changes `changed`, a queue transition changes `pending`, `reflected` and
 * `lastDigest` — and the server resolves that at the bus: **every** frame that
 * names `["docs"]` or `["queue"]` names `["reflect"]` too (SERVER-137). So this
 * query is cached under `REFLECT_KEY` itself and refetches on either, with no
 * `refetchInterval` and no clock of its own. That is deliberate and it is the
 * difference from the agent pill, which needed a tick because *nothing*
 * invalidated the key it read (UI-098): here something does.
 */
export function useReflectStatus(): UseQueryResult<ReflectStatus, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: REFLECT_KEY,
    queryFn: ({ signal }) => client.getReflectStatus({ signal }),
  });
}

/**
 * `POST /api/workspace/reflect` — a person asking for one now.
 *
 * **There is no failure path for "one is already running".** The route answers
 * `202` either way and sets `pending: true` when the ask enqueued nothing, so a
 * second press is answered with the reflection already going to run. A caller
 * therefore never renders an error for it: `onSuccess` refetches the clock, the
 * status comes back with `pending` set, and the control says *reflecting…* —
 * which is what the person wanted to know.
 *
 * Three keys are invalidated rather than one. An ask is a **queue transition**:
 * it writes a `workspace.reflect` event, which changes the console's job list
 * and the queue's depth as much as it changes this control. The server announces
 * all three over SSE anyway; naming them here is what makes the control flip on
 * the press rather than on the frame, exactly as the console's halt does
 * (`useQueueControl`).
 */
export function useAskReflection(): UseMutationResult<ReflectAskResult, Error, void> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ReflectAskResult, Error, void>({
    mutationFn: () => client.askReflection(),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: REFLECT_KEY });
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

/**
 * `PUT /api/workspace/reflect/quiet` — the switch on the board bar (UI-172;
 * SPEC.md §7's rider signed 2026-08-25).
 *
 * ## The response is taken, not invalidated
 *
 * The route answers the whole `ReflectStatus`, so `setQueryData` puts what the
 * server just told us straight into the cache the control reads. Invalidating
 * instead would flip the switch on a second round trip, and the switch is the
 * one control here whose whole job is to answer immediately.
 *
 * Nothing else is invalidated, and that is the difference from
 * {@link useAskReflection}. An ask writes a queue event, so it moves the
 * console's job list and the queue's depth; this writes a config value and
 * moves nothing but the window.
 *
 * ## A failure leaves the switch where the server says it is
 *
 * There is no optimistic update, deliberately. The switch reflects server state
 * and nothing else, so a `PUT` that fails leaves the control showing what is
 * actually configured rather than what somebody hoped for — and the toast is
 * what says the ask did not land.
 */
export function useSetReflectQuiet(): UseMutationResult<ReflectStatus, Error, number> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ReflectStatus, Error, number>({
    mutationFn: (quiet) => client.setReflectQuiet(quiet),
    onSuccess(status) {
      queryClient.setQueryData(REFLECT_KEY, status);
    },
  });
}
