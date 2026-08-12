import { DOCS_KEY, docKey, type CorpusClient } from "@corpus/kit";
import type { QueryClient } from "@tanstack/react-query";
import { isAbandonable } from "./emptiness";
import {
  announceAbandoned,
  beginDelete,
  endDelete,
  forgetDoc,
  forgetPristineBody,
  isDisplayed,
  markAbandoned,
  snapshotOf,
  unmarkAbandoned,
} from "./registry";

/**
 * The act itself: an empty document that has just been left stops existing
 * (SPEC.md §11).
 *
 * **It is the user's own act and asks nothing** (sprint-016 Adjudication 27).
 * §7's "deletion is user-only" constrains the *agent* — the server refuses
 * `actor: agent` — and this runs as the user, on the user's own exit gesture,
 * against signed text that says "automatically deleted". A confirmation prompt
 * would make an automatic rule non-automatic.
 *
 * **The decision is synchronous, the request is not.** `markAbandoned` lands
 * before the first `await`, which is what lets `useAutosave.flush` — running a
 * moment later in the same teardown — decline to send a buffer for a document
 * that is being removed.
 *
 * A refusal is swallowed on purpose. The user asked to leave, not to delete;
 * the only honest correction is the board's own refetch, which will show the
 * document if the server kept it (a refusal that arrived mid-exit is
 * the realistic case).
 */
export async function abandonEmptyDoc(
  docId: string,
  client: CorpusClient,
  queryClient: QueryClient,
): Promise<boolean> {
  if (docId === "" || !beginDelete(docId)) return false;

  const snapshot = snapshotOf(docId);
  if (snapshot === null || !isAbandonable(snapshot)) {
    endDelete(docId);
    forgetDoc(docId);
    return false;
  }

  markAbandoned(docId);
  // Before the request, not after: the stack entry naming this document has to
  // go with it, or Back lands on a tombstone (sprint-016 TEST-428).
  announceAbandoned(docId);

  try {
    await client.deleteDoc(docId);
    void queryClient.invalidateQueries({ queryKey: docKey(docId) });
    void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
  } catch {
    // Nothing to report: the user left a blank document, which is not a request
    // they can act on the failure of.
  }
  forgetDoc(docId);
  forgetPristineBody(docId);
  return true;
}

/**
 * The same act, one microtask later — the form the reader's exit uses.
 *
 * React's development double-mount tears a freshly mounted reader down and puts
 * it straight back, which reaches the exit path with the document still very
 * much open. Deferring by a microtask lets the remount's `retainDoc` land
 * first, so "the last reader let go" means what it says. Nothing else is
 * delayed: the decision, and the `markAbandoned` that keeps a pending autosave
 * from chasing the document, still happen the moment the reader lets go.
 */
export function scheduleAbandonEmptyDoc(
  docId: string,
  client: CorpusClient,
  queryClient: QueryClient,
): void {
  const snapshot = snapshotOf(docId);
  if (snapshot === null || !isAbandonable(snapshot)) {
    forgetDoc(docId);
    return;
  }
  markAbandoned(docId);
  queueMicrotask(() => {
    if (isDisplayed(docId)) {
      unmarkAbandoned(docId);
      return;
    }
    void abandonEmptyDoc(docId, client, queryClient);
  });
}
