import type { Thread, Turn } from "@corpus/contract";

/**
 * The user's own turn, shown before the server has confirmed it (SPEC.md §11 —
 * "optimistic append of the user's own turn, reconciled on refetch").
 *
 * Kept in a provider-level store as well as in the query cache. The cache copy
 * is what makes it render synchronously; the store copy is what makes it
 * survive an SSE invalidation that lands mid-flight, because a refetch replaces
 * cached data wholesale and the store is re-merged by the thread query's own
 * `queryFn`.
 */
export interface PendingTurn extends Turn {
  readonly pending: true;
  /** Identifies this optimistic entry until its mutation settles. */
  readonly clientId: string;
}

/** A turn as the kit hands it to a view: either confirmed, or still pending. */
export type ThreadTurn = Turn | PendingTurn;

/** A thread whose turns may include the user's not-yet-confirmed append. */
export interface ThreadView extends Omit<Thread, "turns"> {
  readonly turns: readonly ThreadTurn[];
}

export function isPendingTurn(turn: ThreadTurn): turn is PendingTurn {
  return "pending" in turn && turn.pending === true;
}

/**
 * Merges still-unsettled optimistic turns into a freshly fetched thread.
 *
 * A pending turn is dropped as soon as the server's copy of it is visible.
 * Turn timestamps are unique and monotonic within a thread (SPEC.md §6), so a
 * confirmed turn by the same author at or after the provisional's timestamp
 * *is* the provisional one — which is what stops the append from appearing
 * twice in the window between the server writing it and the mutation settling.
 *
 * **One confirmed turn cancels exactly one provisional** (PR #10 finding 19).
 * The provisional's timestamp is the client's, the confirmed one's is the
 * server's, and the server's is later — so with two appends in flight the
 * confirmation of the *first* can carry a timestamp past the second
 * provisional's and satisfy a plain "any confirmed turn at or after" test for
 * both. The second turn would then blink out of the conversation until its own
 * response landed. Pairing in order — earliest provisional to the earliest
 * unclaimed confirmation that could be it — cannot do that: two provisionals
 * need two confirmations.
 */
export function mergePendingTurns(thread: Thread, pending: readonly PendingTurn[]): ThreadView {
  const claimed = new Set<string>();
  const survivors = pending.filter((provisional) => {
    const match = thread.turns.find(
      (confirmed) =>
        !claimed.has(confirmed.ts) &&
        confirmed.author === provisional.author &&
        confirmed.ts >= provisional.ts,
    );
    if (match === undefined) return true;
    claimed.add(match.ts);
    return false;
  });
  return survivors.length === 0 ? thread : { ...thread, turns: [...thread.turns, ...survivors] };
}

/**
 * Optimistic turns that have not settled yet, by thread id. One per
 * `CorpusProvider`, so two providers never leak each other's pending state.
 */
export class PendingTurnStore {
  readonly #byThread = new Map<string, PendingTurn[]>();

  add(threadId: string, turn: PendingTurn): void {
    this.#byThread.set(threadId, [...(this.#byThread.get(threadId) ?? []), turn]);
  }

  remove(threadId: string, clientId: string): void {
    const remaining = (this.#byThread.get(threadId) ?? []).filter(
      (turn) => turn.clientId !== clientId,
    );
    if (remaining.length === 0) this.#byThread.delete(threadId);
    else this.#byThread.set(threadId, remaining);
  }

  list(threadId: string): readonly PendingTurn[] {
    return this.#byThread.get(threadId) ?? [];
  }
}
