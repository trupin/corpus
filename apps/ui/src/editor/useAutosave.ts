import type { UpdateDocResponse } from "@corpus/contract";
import { useUpdateDocById } from "@corpus/kit";
import { useCallback, useEffect, useRef, useState } from "react";
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
      void mutate
        .current({ id: job.docId, changes: { body: job.body } })
        .then((response: UpdateDocResponse) => {
          inFlight.current = false;
          retried.current = false;
          lastSaved.current = job.body;
          setState({
            kind: "saved",
            remapped: response.anchors.remapped.length,
            orphaned: response.anchors.orphaned.length,
          });
          anchors.current?.({
            docId: job.docId,
            revision: stamp,
            remapped: response.anchors.remapped,
            orphaned: response.anchors.orphaned,
            warnings: response.warnings.map((warning) => `${warning.code}: ${warning.detail}`),
          });
          armSettle(job.docId);
        })
        .catch((error: unknown) => {
          inFlight.current = false;
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

  const flush = useCallback((): void => {
    clearTimer(debounce);
    const job = pending.current;
    if (job === null || inFlight.current || isLocked.current) return;
    send(job);
  }, [send]);

  const change = useCallback(
    (body: string): void => {
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
        if (job !== null && !inFlight.current) send(job);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [armSettle, docId, send],
  );

  const retry = useCallback((): void => {
    retried.current = false;
    flush();
  }, [flush]);

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
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  useEffect(
    () => () => {
      flush();
      clearTimer(debounce);
      clearTimer(settle);
      endEditing(docId);
    },
    [docId, flush],
  );

  return {
    state,
    change,
    flush,
    retry,
  };
}
