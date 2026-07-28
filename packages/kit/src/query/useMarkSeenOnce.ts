import { useCallback } from "react";
import { useMarkThreadSeen } from "./useThreadStatus.js";

/**
 * SPEC.md §7's read rule, de-duplicated: one `POST /api/threads/{id}/seen` per
 * `(threadId, lastTurnTs)` pair, no matter how many surfaces displayed the
 * thread or how often one of them was collapsed and re-expanded.
 *
 * **The pair is the client's key, not a request field.** `markThreadSeen(id)`
 * deliberately sends no `lastSeenTs` — the contract's optional parameter records
 * a *partial* read, and every caller here is a surface that displayed the whole
 * conversation. Sending it would have the UI assert what the user read instead
 * of the server recording what was displayed, and the `unread` field in the
 * response would then be answering a question the UI made up. What the pair
 * buys is only this: an expand/collapse/expand burst issues one request, and a
 * new turn arriving re-arms it because the pair changed.
 *
 * The record is module-level rather than per-component because the same thread
 * is displayed by several surfaces at once — a margin card, a column reader and
 * a chip can all be looking at it — and a per-component ref would let each of
 * them spend a request on the same fact.
 */
const marks = new Map<string, string>();

/** Test seam: forgets every recorded mark. */
export function resetSeenMarks(): void {
  marks.clear();
}

/** Test seam: whether this exact pair has already been sent. */
export function hasSeenMark(threadId: string, lastTurnTs: string): boolean {
  return marks.get(threadId) === lastTurnTs;
}

export interface MarkSeenOnce {
  /**
   * Records that this thread was *displayed* up to `lastTurnTs`. Sends at most
   * one request per pair; a thread with no turns is never marked, because there
   * is nothing to have read.
   */
  readonly markSeen: (threadId: string, lastTurnTs: string | undefined) => void;
}

export function useMarkSeenOnce(): MarkSeenOnce {
  const mutation = useMarkThreadSeen();
  const mutate = mutation.mutate;

  const markSeen = useCallback(
    (threadId: string, lastTurnTs: string | undefined) => {
      // A thread with no turns cannot be unread — there is nothing to have read
      // — so an absent last turn is not a mark waiting to be sent.
      if (threadId === "" || lastTurnTs === undefined || lastTurnTs === "") return;
      if (marks.get(threadId) === lastTurnTs) return;
      // Recorded before the request goes out: two surfaces mounting in the same
      // tick must not both see an empty record and both post.
      marks.set(threadId, lastTurnTs);
      mutate(threadId, {
        onError: () => {
          // A failed mark is not a recorded one — otherwise a dropped connection
          // would leave the badge lit and the client convinced it had cleared it.
          if (marks.get(threadId) === lastTurnTs) marks.delete(threadId);
        },
      });
    },
    [mutate],
  );

  return { markSeen };
}
