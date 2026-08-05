import type { UpdateDocResponse } from "@corpus/contract";
import { useUpdateDocById } from "@corpus/kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { onPageHide } from "../abandon/pagehide.js";
import { isAbandoned, publishBodyDraft } from "../abandon/registry.js";
import { beginEditWrite, endEditWrite } from "./editSessionFlush.js";
import { beginEditing, endEditing } from "./editingRegistry.js";

/**
 * Autosave: the reason SPEC.md §11 can say "no edit mode" and mean it.
 *
 * There is no save button anywhere in Corpus, so this is the only thing
 * standing between a typed sentence and the file on disk — and everything it
 * reports has to be true. The chip states are driven by the `PUT`'s lifecycle
 * and by nothing else: no timers advancing a claim the server has not made, no
 * optimism, no "probably saved by now".
 *
 * Two states, not three (sprint-011 Adjudication 1). The server commits inside
 * the mutation pipeline, so a `PUT` that has answered *is* committed — there is
 * no separate "committed" moment to wait for and no field on the wire that
 * would announce one.
 *
 * **It never dispatches a transaction.** The editor hands it a string; it
 * hands the server a string. Autosave that touched the document would push
 * steps onto ProseMirror's undo stack, and a save landing mid-sentence would
 * make ⌘Z undo the save instead of the sentence (sprint-011 TEST-21).
 */

/** SPEC.md §11's "autosave (debounced)". Long enough to coalesce a burst of typing. */
export const AUTOSAVE_DEBOUNCE_MS = 700;

/**
 * How long after the last keystroke an editing session is considered settled.
 *
 * It gates the deferred SSE update, so it trades "the user sees an external
 * change promptly" against "an external change lands between two words".
 */
export const EDIT_SETTLE_MS = 2_000;

/** One automatic retry, then the chip asks. A save loop is worse than a stuck chip. */
export const RETRY_DELAY_MS = 3_000;

export type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly remapped: number; readonly orphaned: number }
  | { readonly kind: "error"; readonly message: string };

/** What the server said about anchors, forwarded so UI-007 can refresh decorations. */
export interface AnchorReport {
  readonly docId: string;
  /**
   * Monotonic per save, so a consumer can ignore a report that describes a body
   * two saves ago.
   *
   * Nothing here can currently deliver one out of order — a second `PUT` is
   * never started while one is in flight — but the anchor layer treats the
   * report as authoritative over its own mapping, and "authoritative" has to
   * mean the newest one (sprint-011 TEST-109).
   */
  readonly revision: number;
  readonly remapped: readonly string[];
  readonly orphaned: readonly string[];
  readonly warnings: readonly string[];
}

export interface UseAutosaveOptions {
  /** The document being edited. Changing it flushes the previous one first. */
  readonly docId: string;
  /** The body as it stands on the server; the baseline a save is compared against. */
  readonly savedBody: string;
  /** Writes are refused while another party holds the lock (SPEC.md §7). */
  readonly locked: boolean;
  /**
   * Called with every `PUT` response's anchor report. Declared now, consumed by
   * UI-007: reconciliation is what re-anchors the highlights after a save.
   */
  readonly onAnchors?: ((report: AnchorReport) => void) | undefined;
}

export interface Autosave {
  readonly state: SaveState;
  /** The editor's `onUpdate`, with the freshly serialized body. */
  readonly change: (body: string) => void;
  /** Send any pending save immediately (unmount, doc switch, tab hidden). */
  readonly flush: () => void;
  /** Re-send the buffer after a failure. */
  readonly retry: () => void;
}

interface Pending {
  readonly docId: string;
  readonly body: string;
}

export function useAutosave({ docId, savedBody, locked, onAnchors }: UseAutosaveOptions): Autosave {
  const update = useUpdateDocById();
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  /**
   * Everything the timers touch lives in refs.
   *
   * A debounce that closed over render state would send whatever the body was
   * when the timer was armed, which for a fast typist is several keystrokes
   * ago. These are read at fire time, not at schedule time.
   */
  const pending = useRef<Pending | null>(null);
  const lastSaved = useRef<string>(savedBody);
  const inFlight = useRef(false);
  const retried = useRef(false);
  /** Stamps each save so a late response cannot overwrite a newer one's report. */
  const revision = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutate = useRef(update.mutateAsync);
  mutate.current = update.mutateAsync;
  const anchors = useRef(onAnchors);
  anchors.current = onAnchors;
  const isLocked = useRef(locked);
  isLocked.current = locked;
  /**
   * True once this hook has stopped owning a surface for the document a
   * response is about — the surface unmounted, or it rebound onto another
   * document. Read by the failure handler, which is the one place that would
   * otherwise schedule work for a surface that is gone.
   */
  const retired = useRef(false);
  const boundDoc = useRef(docId);
  boundDoc.current = docId;

  const clearTimer = (timer: typeof debounce): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  /**
   * Ends the editing session when nothing is outstanding.
   *
   * Both conditions matter: a buffer waiting to be sent means the server does
   * not have the user's text yet, and adopting an incoming body then would
   * discard it.
   */
  const settleIfQuiet = useCallback((id: string): void => {
    if (pending.current !== null || inFlight.current) return;
    endEditing(id);
  }, []);

  const armSettle = useCallback(
    (id: string): void => {
      clearTimer(settle);
      settle.current = setTimeout(() => {
        settle.current = null;
        settleIfQuiet(id);
      }, EDIT_SETTLE_MS);
    },
    [settleIfQuiet],
  );

  const send = useCallback(
    (job: Pending): void => {
      pending.current = null;
      inFlight.current = true;
      revision.current += 1;
      const stamp = revision.current;
      setState({ kind: "saving" });
      /*
       * This is the write that opens SPEC.md §4's edit session, so the close
       * path has to know it is on the wire: a reader closed while it is in
       * flight must not flush the session until it has landed, or the range the
       * acknowledgment describes stops one save short of what the user typed
       * (`editSessionFlush.ts`).
       */
      beginEditWrite(job.docId);
      void mutate
        .current({ id: job.docId, changes: { body: job.body } })
        .then((response: UpdateDocResponse) => {
          inFlight.current = false;
          endEditWrite(job.docId, true);
          retried.current = false;
          lastSaved.current = job.body;
          anchors.current?.({
            docId: job.docId,
            revision: stamp,
            remapped: response.anchors.remapped,
            orphaned: response.anchors.orphaned,
            warnings: response.warnings.map((warning) => `${warning.code}: ${warning.detail}`),
          });

          /**
           * The buffer moved on while this `PUT` was on the wire.
           *
           * Nothing else would ever send it. The debounce that fired during the
           * flight declined to start a second request and did not re-arm, and a
           * `flush` refuses while one is in flight — so without this the newest
           * text lives only in memory until the *next* keystroke, which on a
           * document the user has stopped typing into never comes. A save that
           * takes longer than the 700 ms window is not exotic; a large document
           * over a busy server is the ordinary case.
           *
           * It is sent immediately rather than re-debounced, because everything
           * downstream is waiting on it: the chip would claim `committed` over
           * unsaved text, the editing session would never settle, the deferred
           * SSE update would never land, and a comment queued behind the
           * editing session (`useAnchorLayer.submitComment`) would never post.
           * Requests stay serialized — one `PUT` at a time, coalescing whatever
           * was typed during the previous one.
           */
          const next = pending.current;
          const superseded =
            next !== null && next.docId === job.docId && next.body === lastSaved.current;
          if (superseded) pending.current = null;
          if (next !== null && !superseded) {
            clearTimer(debounce);
            if (isLocked.current) {
              // A foreign lock arrived mid-save: the server would refuse this
              // one too, so it waits — but the chip says so rather than
              // reporting a save that the buffer contradicts. The effect below
              // sends it the moment the lock clears.
              setState({
                kind: "error",
                message: "the document is locked — this edit is not saved yet",
              });
              return;
            }
            send(next);
            return;
          }
          setState({
            kind: "saved",
            remapped: response.anchors.remapped.length,
            orphaned: response.anchors.orphaned.length,
          });
          armSettle(job.docId);
        })
        .catch((error: unknown) => {
          inFlight.current = false;
          // Refused, so it committed nothing and opened no session — but the
          // close path was waiting on it and must stop.
          endEditWrite(job.docId, false);
          /**
           * A refusal owed to a surface that no longer exists ends here.
           *
           * The retry below is a timer, and the only thing that clears it is
           * this hook's cleanup — which has already run whenever the request it
           * would retry was the *teardown* flush. That orphan is not merely a
           * stray request. The line above has just told `editSessionFlush` this
           * write is settled, so its sweep ends the session 300 ms later over
           * the range that actually committed; a `PUT` landing three seconds
           * behind that opens a **second** session with no surface left to
           * close it, and one sitting becomes two `doc.edited` events and two
           * acknowledgment threads. The invariant that module states — *a flush
           * never ends a session while a write for that document may still
           * land* — holds only if no write can be started after the last
           * surface for the document is gone.
           *
           * Holding the write open across the retry window would satisfy the
           * invariant too, and was rejected: it parks the acknowledgment three
           * seconds behind the close for a request nobody is waiting on, and
           * the hold would have to be released down every path that cancels the
           * retry — one missed release wedges that document's flush for the life
           * of the tab.
           *
           * What that costs is one debounce window of text, on a save that
           * failed exactly as the reader closed. Nothing here could have saved
           * it in any case: there is no chip left to report the failure and no
           * user left to press retry, and parking the body somewhere that
           * outlives its surface is the second source of truth for a document
           * body that SPEC.md §5 is most careful about — the same reason the
           * buffer is not rescued from behind a foreign lock. The acknowledgment
           * then describes what the server actually has, which is the honest
           * range. The chip and the buffer are skipped with it: nothing renders
           * the one, and nothing can type over the other.
           */
          if (retired.current || boundDoc.current !== job.docId) return;
          // The buffer is put back, not discarded: the text the user typed is
          // the only copy of it that exists.
          pending.current ??= job;
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "the server refused the save",
          });
          if (retried.current) return;
          retried.current = true;
          clearTimer(debounce);
          debounce.current = setTimeout(() => {
            debounce.current = null;
            const next = pending.current;
            if (next !== null) send(next);
          }, RETRY_DELAY_MS);
        });
    },
    [armSettle],
  );

  /**
   * Send the buffer now, unless something is already carrying it.
   *
   * Declining while a `PUT` is in flight is not a drop: the completion handler
   * picks the buffer up and sends it, so a flush that lands mid-request still
   * ends with the text on disk.
   *
   * **Declining under a foreign lock is different, and it is deliberate**
   * (UI-013 rider). The server refuses a write to a locked document (SPEC.md
   * §7), so there is no version of this that saves the text: sending it would
   * produce a `423` and an error chip claiming a failure the user cannot act
   * on. The buffer therefore waits for the lock to clear — the effect below
   * sends it the moment it does — and while it waits the chip says, in words,
   * that the edit is not saved yet.
   *
   * What that costs: if the *surface* goes before the lock clears, the buffer
   * goes with it. Within the app that is a navigation the user made knowing
   * the chip's state; leaving the page is not, so it is the one case worth
   * intercepting, and {@link useAutosave} does (`beforeunload`, below).
   * Reproducing the text elsewhere — a draft store outliving the reader —
   * would be a second source of truth for a document body, which is the thing
   * SPEC.md §5 is most careful about.
   */
  const flush = useCallback((): void => {
    clearTimer(debounce);
    const job = pending.current;
    if (job === null || inFlight.current || isLocked.current) return;
    // The document is being removed for being empty (SPEC.md §11). Its buffer
    // is by definition the emptiness that decided it, and sending it would be a
    // `PUT` racing the `DELETE` that follows.
    if (isAbandoned(job.docId)) return;
    send(job);
  }, [send]);

  const change = useCallback(
    (body: string): void => {
      // The abandon rule is decided against the body the editor holds *now*,
      // which for a fast typist is several keystrokes ahead of the corpus.
      publishBodyDraft(docId, body);
      // The comparison is against the last SAVED body, never against "the
      // editor fired an update": typing a character and deleting it is not a
      // change, and must not cost a request (sprint-011 TEST-16).
      if (body === lastSaved.current) {
        pending.current = null;
        clearTimer(debounce);
        // `armSettle` only ends the session once nothing is in flight, so this
        // is safe even while the previous save is still on the wire.
        armSettle(docId);
        return;
      }
      beginEditing(docId);
      pending.current = { docId, body };
      clearTimer(settle);
      // Writes are refused under a foreign lock, so nothing is scheduled; the
      // buffer is kept, and the editor is `editable: false` anyway.
      if (isLocked.current) return;
      clearTimer(debounce);
      debounce.current = setTimeout(() => {
        debounce.current = null;
        const job = pending.current;
        // Two `PUT`s for one document must never overlap — the second could
        // land first and resurrect an older body. When one is in flight the
        // buffer stays put and its completion handler sends it.
        if (job !== null && !inFlight.current) send(job);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [armSettle, docId, send],
  );

  const retry = useCallback((): void => {
    retried.current = false;
    flush();
  }, [flush]);

  /**
   * The lock cleared and a buffer is still waiting on it.
   *
   * The only way to get here is the race the completion handler parks on: a
   * foreign lock arrived while the user's save was on the wire. Nothing else
   * would restart that save — the editor was read-only in the meantime, so
   * there is no keystroke coming to re-arm the debounce.
   */
  useEffect(() => {
    if (!locked) flush();
  }, [flush, locked]);

  /** The server's copy moved on (a save landed, or somebody else wrote). */
  useEffect(() => {
    if (pending.current === null && !inFlight.current) lastSaved.current = savedBody;
  }, [savedBody]);

  /**
   * The buffer must not outlive the surface that holds it.
   *
   * A pending save flushes when the reader unmounts, when it rebinds to
   * another document, and when the tab is hidden — the three ways a debounce
   * window ends with the user believing their text is saved. The flush carries
   * the **outgoing** document's id, which is why the buffer holds one.
   */
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    /**
     * The one parked buffer that can still be rescued (UI-013 rider).
     *
     * A buffer waiting behind a foreign lock cannot be sent — the server would
     * refuse it — so the only thing that keeps the text alive is the tab that
     * holds it. Closing or reloading destroys the only copy, silently, and the
     * chip that was saying so goes with it. This is the browser's own "leave
     * without saving?" and it fires for exactly that state: an unsent buffer
     * under a lock this session does not hold.
     *
     * An ordinary pending save needs nothing here: `pagehide` flushes it, and
     * a prompt on every unloaded page with an unsettled debounce would be the
     * kind of dialog people learn to dismiss without reading.
     */
    const onLeave = (event: BeforeUnloadEvent): void => {
      if (pending.current === null || !isLocked.current) return;
      event.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    /*
     * The tab-close flush joins the ordered sequence rather than adding a fourth
     * `pagehide` listener: it declines for a document the abandon rule is
     * removing, and a plain listener registered here — in a child of the reader
     * — would run *before* that decision was taken and send a `PUT` chasing the
     * `DELETE` behind it (PR #12 review, MINOR 14).
     */
    const offPageHide = onPageHide("flush", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
      offPageHide();
    };
  }, [flush]);

  useEffect(() => {
    retired.current = false;
    return () => {
      /*
       * Retired *before* the final flush, not after: that flush is the last
       * request this surface will ever make, and whether it succeeds or fails
       * there is no longer anything here to report to or retry for. Every timer
       * this hook owns is cleared on the next two lines, so anything armed from
       * here on could never be cleared at all.
       */
      retired.current = true;
      flush();
      clearTimer(debounce);
      clearTimer(settle);
      endEditing(docId);
    };
  }, [docId, flush]);

  return {
    state,
    change,
    flush,
    retry,
  };
}
