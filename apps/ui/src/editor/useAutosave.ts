import type { Doc, UpdateDocResponse } from "@corpus/contract";
import { staleKeyDoc, useUpdateDocById } from "@corpus/kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { onPageHide } from "../abandon/pagehide.js";
import { isAbandoned, publishBodyDraft } from "../abandon/registry.js";
import { beginEditWrite, endEditWrite } from "./editSessionFlush.js";
import { beginEditing, endEditing } from "./editingRegistry.js";

/**
 * Autosave: the reason SPEC.md §10 can say "no edit mode" and mean it.
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
 *
 * ## The key, and what a refusal may never cost (SPEC.md §7)
 *
 * The board is one of the document's two writers, and it presents a **key** like
 * the other one: every save carries the key of the version this editor last read
 * or wrote, and the server refuses the write if the document has moved since.
 * There is no lock any more — no document renders read-only, nothing is
 * acquired, nothing waits — so the only thing standing between two writers is
 * this exchange.
 *
 * **A refusal must never cost the person a word, and that is the whole design
 * constraint here.** A `409` arrives while somebody is mid-sentence; it carries
 * the document as it now stands and a fresh key for it. What happens then:
 *
 * 1. the buffer is **kept** — it is put back exactly as any failure puts it
 *    back, because the text the person typed is the only copy of it that exists;
 * 2. the fresh key is **adopted**, and the refusal's document is handed to the
 *    host ({@link UseAutosaveOptions.onServerDoc}) so the app's picture of the
 *    server is current — the editor's own "an external change while the user is
 *    typing" rule then owns the body, and that rule defers while a session is
 *    open, which is precisely the state a mid-sentence refusal is;
 * 3. the save is **retried** immediately, against the key just adopted.
 *
 * So the sentence lands. Nothing is dropped, nothing is replaced under the
 * caret, and the editor is never reset to the server's copy while the person is
 * still typing into it. The retry is bounded ({@link MAX_CONFLICT_RETRIES}):
 * past that the buffer is still kept and the chip says, in words, that the text
 * is not saved yet — a stuck chip over held text, never a save loop and never a
 * discarded edit.
 */

/** SPEC.md §10's "autosave (debounced)". Long enough to coalesce a burst of typing. */
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

/**
 * How many times one buffer may be re-sent against a freshly adopted key before
 * the editor stops and says so (SPEC.md §7).
 *
 * A refusal means the document moved, so adopting the key it carried and writing
 * again is the documented recovery — but a writer hammering the same document
 * would otherwise put this in a loop that never reports anything. Bounded, the
 * failure mode is a chip that says the text is not saved yet over a buffer that
 * still holds every word of it, which the person can retry by hand.
 */
export const MAX_CONFLICT_RETRIES = 3;

/** What the chip says once the conflict budget is spent. Names the state, honestly. */
export const CONFLICT_STALLED_MESSAGE =
  "the document changed while you were typing — your text is kept here, not saved yet";

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
  /**
   * SPEC.md §7's **key** for the version {@link savedBody} came from — opaque,
   * echoed back on the next save, and never computed here.
   *
   * It travels beside the body rather than being derived from it because it
   * names the whole *file*: a frontmatter-only change (a tag the agent added, a
   * title the person just wrote) moves the key without moving the body, and a
   * writer that re-derived one from the text it holds would have manufactured
   * evidence it never read anything.
   */
  readonly savedKey: string;
  /**
   * Called with every `PUT` response's anchor report. Declared now, consumed by
   * UI-007: reconciliation is what re-anchors the highlights after a save.
   */
  readonly onAnchors?: ((report: AnchorReport) => void) | undefined;
  /**
   * Every **authoritative** document the server hands back: the one a save
   * wrote, and the one a `409` refused against (SPEC.md §7's *what a refusal
   * says*).
   *
   * The host publishes it into the document cache, which is the same channel an
   * SSE-driven refetch uses — so a refusal reaches the editor as an ordinary
   * external change, subject to the rule that already governs those, rather than
   * through a second adoption mechanism written for conflicts alone. It also
   * makes a landed save read-your-write: the reader shows what the server
   * stored, at the instant it stored it, with no refetch in between.
   */
  readonly onServerDoc?: ((doc: Doc) => void) | undefined;
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

export function useAutosave({
  docId,
  savedBody,
  savedKey,
  onAnchors,
  onServerDoc,
}: UseAutosaveOptions): Autosave {
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
  const serverDoc = useRef(onServerDoc);
  serverDoc.current = onServerDoc;
  /**
   * The key this editor presents on its next save: the one its last **read** or
   * its last **write** carried, and nothing else. Opaque — echoed, never parsed,
   * never constructed (SPEC.md §7).
   */
  const documentKey = useRef(savedKey);
  /** Consecutive stale-key refusals for the buffer in hand. Reset by a landed save. */
  const conflicts = useRef(0);
  /**
   * The server refused the buffer in hand and it has not landed since.
   *
   * Read by the `beforeunload` guard below: this is the one state in which
   * closing the tab destroys the only copy of what the person wrote, because
   * every other unsent buffer is flushed on the way out.
   */
  const refused = useRef(false);
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
        // SPEC.md §7: a write that replaces the body presents the key of the
        // version it read. Echoed exactly as received — this is the only place
        // the key leaves the client, and it never leaves as anything but the
        // string the server last handed over.
        .current({ id: job.docId, changes: { body: job.body, key: documentKey.current } })
        .then((response: UpdateDocResponse) => {
          inFlight.current = false;
          endEditWrite(job.docId, true);
          retried.current = false;
          conflicts.current = 0;
          refused.current = false;
          lastSaved.current = job.body;
          // "Every write that lands gives you a fresh key for the next one."
          documentKey.current = response.doc.key;
          serverDoc.current?.(response.doc);
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
           * body that SPEC.md §5 is most careful about. The acknowledgment then
           * describes what the server actually has, which is the honest range.
           * The chip and the buffer are skipped with it: nothing renders the
           * one, and nothing can type over the other.
           */
          if (retired.current || boundDoc.current !== job.docId) return;
          // The buffer is put back, not discarded: the text the user typed is
          // the only copy of it that exists. **This line is the guarantee** —
          // it runs before anything below decides what kind of failure this was,
          // so no refusal, of any shape, can reach a branch that has already
          // dropped the person's sentence.
          pending.current ??= job;
          refused.current = true;

          /**
           * SPEC.md §7's refusal: **the key named a version this document no
           * longer is.** Adopt, then retry.
           *
           * The refusal carries the document as it now stands and a fresh key
           * for it, so one exchange is all it takes. The document goes to the
           * host, which publishes it where an SSE refetch would have — the
           * editor's existing "an external change while the user is typing" rule
           * then decides what to do with the body, and that rule holds the
           * incoming copy back while a session is open. **The person's text is
           * never replaced under the caret**, and the buffer above is re-sent
           * against the key just adopted, which is what makes the sentence land
           * rather than merely survive.
           *
           * Not an error chip: a conflict the mechanism resolves in one exchange
           * is not a failure to report, and reporting it would train people to
           * ignore the chip that means something.
           */
          const current = staleKeyDoc(error);
          if (current !== null) {
            documentKey.current = current.key;
            serverDoc.current?.(current);
            const next = pending.current;
            if (conflicts.current < MAX_CONFLICT_RETRIES && next !== null) {
              conflicts.current += 1;
              clearTimer(debounce);
              send(next);
              return;
            }
            // The budget is spent and the buffer is still whole. Say so, and
            // leave it exactly where it is — `retry` re-sends it by hand.
            setState({ kind: "error", message: CONFLICT_STALLED_MESSAGE });
            return;
          }

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
   * **Nothing parks a buffer any more.** It used to wait behind a foreign lock,
   * because the server refused every write to a locked document and sending one
   * could only produce a failure the person could not act on. There is no lock
   * (SPEC.md §7), and a key refusal is not that: it comes back with the document
   * and a fresh key, so the way to save the text is to send it — which is what
   * the conflict path in `send` does.
   */
  const flush = useCallback((): void => {
    clearTimer(debounce);
    const job = pending.current;
    if (job === null || inFlight.current) return;
    // The document is being removed for being empty (SPEC.md §10). Its buffer
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
      // A fresh keystroke is a fresh attempt: the conflict budget is per buffer,
      // not per session, so a person who keeps writing is never refused for
      // conflicts an earlier sentence already spent.
      conflicts.current = 0;
      clearTimer(settle);
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
    conflicts.current = 0;
    flush();
  }, [flush]);

  /**
   * The server's copy moved on (a save landed, or somebody else wrote).
   *
   * The body and its key travel together, because they describe one version:
   * taking a key without the body it names would be presenting evidence of a
   * read that never happened, which is exactly what SPEC.md §7 refuses.
   *
   * **The one exception is a key that arrives with the body already in hand.**
   * A frontmatter-only write — the person's own title edit, a tag the agent
   * added — moves the file's key and leaves the block this editor replaces
   * untouched. Taking the key then adopts nothing unread, and not taking it
   * would refuse the next sentence over a change that cannot collide with it.
   */
  useEffect(() => {
    if (pending.current === null && !inFlight.current) {
      lastSaved.current = savedBody;
      documentKey.current = savedKey;
      return;
    }
    if (savedBody === lastSaved.current) documentKey.current = savedKey;
  }, [savedBody, savedKey]);

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
     * The one buffer that closing the tab would destroy.
     *
     * A save the server **refused** and that has not landed since is text the
     * flush below cannot rescue: sending it again is exactly what already
     * failed. The only thing keeping it alive is the tab, so closing or
     * reloading destroys the only copy silently, and the chip that was saying so
     * goes with it. This is the browser's own "leave without saving?", fired for
     * precisely that state.
     *
     * An ordinary pending save needs nothing here: `pagehide` flushes it, and a
     * prompt on every unloaded page with an unsettled debounce would be the kind
     * of dialog people learn to dismiss without reading.
     */
    const onLeave = (event: BeforeUnloadEvent): void => {
      if (pending.current === null || !refused.current) return;
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
