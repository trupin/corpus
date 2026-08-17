import type { AppendTurnResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient, usePendingTurnStore } from "../client/context.js";
import { DOCS_KEY, docKey, JOBS_KEY, QUEUE_KEY, threadKey } from "./keys.js";
import { isPendingTurn, type PendingTurn, type ThreadView } from "./pendingTurns.js";

/**
 * `POST /api/threads/{id}/turns` with an optimistic append of the user's own
 * turn (SPEC.md §11).
 *
 * The provisional turn lands in the `["threads", id]` cache synchronously,
 * marked `pending` so a view can render it differently, and is reconciled by
 * timestamp: turn timestamps are unique and monotonic within a thread (SPEC.md
 * §6), so the server's copy *replaces* the provisional one instead of appearing
 * beside it. A failed mutation restores the pre-mutation snapshot and rethrows.
 */

export interface AppendTurnVariables {
  readonly body: string;
  /** Enqueue signal for the agent (SPEC.md §8); omitted lets the server decide. */
  readonly requestsAgent?: boolean;
  /**
   * The weight this request states (SPEC.md §7, §11) — a **Key** token from the
   * workspace's own guidance. Omit for "the orchestrator decides", which is the
   * ordinary case; there is no default and no other spelling of absence.
   *
   * It rides on **both** request shapes below, because §11 names Capture and a
   * comment carrying a file among the surfaces that may state one: a weight that
   * survived only the JSON path would be silently dropped by attaching a file.
   */
  readonly weight?: string;
  /**
   * The lane this turn is addressed to (SPEC.md §7): `orchestrator`, or the id
   * of a designated root thread.
   *
   * **Omit it when nobody picked**, which is the ordinary case: the server
   * computes the default from where the turn is posted, and a composer that has
   * worked the default out for display still omits it — absence is the only
   * spelling of "nobody chose", so the client's rule and the server's cannot
   * come apart about it.
   *
   * **Present for every pick**, including one that names the lane the composer
   * had already computed. That is not redundancy: the two walks can disagree
   * (this side's is bounded and reads a cached roster), and a person who pressed
   * a lane addressed *that lane*, which the server may then refuse with a `422`
   * rather than quietly route somewhere else (UI-118, SERVER-111). It still
   * routes that message and nothing else.
   *
   * On **both** request shapes, for the reason `weight` is: a recipient that
   * survived only the JSON path would be silently dropped by attaching a file.
   */
  readonly recipient?: string;
  /**
   * Attachments (SPEC.md §6). Present and non-empty switches the request to
   * `multipart/form-data`; a turn carrying files may have an empty `body`.
   */
  readonly files?: readonly File[];
}

/** The provisional body an attachment-only turn shows until the server answers. */
export function provisionalBody(variables: AppendTurnVariables): string {
  if (variables.body !== "") return variables.body;
  return (variables.files ?? []).map((file) => file.name).join("\n");
}

interface AppendTurnContext {
  readonly snapshot: ThreadView | undefined;
  readonly clientId: string;
}

let sequence = 0;

function nextClientId(): string {
  sequence += 1;
  return `pending-${String(sequence)}`;
}

export function useAppendTurn(
  threadId: string,
): UseMutationResult<AppendTurnResponse, Error, AppendTurnVariables, AppendTurnContext> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const pendingTurns = usePendingTurnStore();
  const key = threadKey(threadId);

  return useMutation<AppendTurnResponse, Error, AppendTurnVariables, AppendTurnContext>({
    mutationFn: (variables) => {
      const files = variables.files ?? [];
      const requestsAgent =
        variables.requestsAgent === undefined ? {} : { requestsAgent: variables.requestsAgent };
      const weight = variables.weight === undefined ? {} : { weight: variables.weight };
      const recipient = variables.recipient === undefined ? {} : { recipient: variables.recipient };
      // Two requests, one call site: the JSON route cannot carry a repeated
      // binary part, and the multipart route names the prose field `text`.
      if (files.length === 0)
        return client.appendTurn(threadId, {
          body: variables.body,
          ...requestsAgent,
          ...weight,
          ...recipient,
        });
      return client.appendTurnWithFiles(threadId, {
        ...(variables.body === "" ? {} : { text: variables.body }),
        ...requestsAgent,
        ...weight,
        ...recipient,
        files,
      });
    },

    async onMutate(variables) {
      const snapshot = queryClient.getQueryData<ThreadView>(key);
      const provisional: PendingTurn = {
        author: "user",
        ts: new Date().toISOString(),
        body: provisionalBody(variables),
        // A person's turn names no model (SPEC.md §11) — never a placeholder.
        model: null,
        pending: true,
        clientId: nextClientId(),
      };
      // Registered before anything is awaited, so `useThread`'s `queryFn` will
      // re-merge it into any refetch that lands while the POST is in flight.
      pendingTurns.add(threadId, provisional);
      if (snapshot !== undefined) {
        queryClient.setQueryData<ThreadView>(key, {
          ...snapshot,
          turns: [...snapshot.turns, provisional],
        });
      }
      // TanStack's mutation-aware pattern: a refetch that was already in flight
      // would otherwise resolve after the write above and replace it with
      // server data that does not carry this turn yet. The store makes that
      // survivable, and cancelling makes it not happen.
      await queryClient.cancelQueries({ queryKey: key });
      return { snapshot, clientId: provisional.clientId };
    },

    onSuccess(data, _variables, context) {
      pendingTurns.remove(threadId, context.clientId);
      queryClient.setQueryData<ThreadView>(key, (current) => {
        if (current === undefined) return current;
        const confirmed = current.turns.filter(
          (turn) => !(isPendingTurn(turn) && turn.clientId === context.clientId),
        );
        const alreadyPresent = confirmed.some(
          (turn) => turn.author === data.turn.author && turn.ts === data.turn.ts,
        );
        return { ...current, turns: alreadyPresent ? confirmed : [...confirmed, data.turn] };
      });
      // The server's own `invalidate` frame covers a connected client; doing it
      // here too keeps the mutation correct when the stream is down, which is
      // exactly when a user is most likely to be retrying.
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      // A turn that enqueued produced a job, and the queue is where "is a
      // response outstanding?" is answered — the console's depth and the thread
      // card's pending row both read it (SPEC.md §8, UI-058). A turn that
      // enqueued nothing changed neither, so neither is dropped.
      if (data.eventId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
        void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      }
    },

    onError(_error, _variables, context) {
      if (context === undefined) return;
      pendingTurns.remove(threadId, context.clientId);
      if (context.snapshot === undefined) queryClient.removeQueries({ queryKey: key, exact: true });
      else queryClient.setQueryData<ThreadView>(key, context.snapshot);
    },
  });
}
