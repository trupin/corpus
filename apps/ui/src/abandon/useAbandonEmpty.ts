import type { Doc } from "@corpus/contract";
import { useCorpusClient } from "@corpus/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { abandonEmptyDoc, scheduleAbandonEmptyDoc } from "./abandonEmptyDoc";
import { publishDoc, releaseDoc, retainDoc, subscribeAbandoned } from "./registry";
import { unloadClient } from "./unloadClient";

/**
 * A reader's half of the abandon rule (SPEC.md §11): while this host displays a
 * document it publishes what it knows about it, and the moment it stops
 * displaying it — for any reason — an empty one is removed.
 *
 * **"Exiting the doc" is the document ceasing to be displayed** (sprint-016
 * Adjudication 17). Back, `esc`/`⌫`, ⇧-Back to the list, another document
 * taking over this reader, the host unmounting, and the tab closing are all the
 * same event here, which is why there is one seam rather than five call sites
 * that could each forget one. Switching the *active column* is deliberately not
 * an exit: readers are per-column and the document stays open.
 *
 * **A `useLayoutEffect`, and that is load-bearing.** Layout-effect teardown runs
 * in the commit's mutation phase, ahead of the passive teardown that carries
 * `useAutosave`'s unmount flush — so the abandon decision is recorded before
 * the flush asks whether to send its buffer, and no `PUT` chases a document
 * that is being deleted (sprint-016 TEST-425).
 */

export interface AbandonEmptyOptions {
  /** The document showing right now; `""` while the host has none. */
  readonly docId: string;
  /** The corpus's copy, when it has arrived. */
  readonly doc: Doc | undefined;
  /** Threads **on** the document — one of them makes it un-abandonable. */
  readonly threadCount: number;
  /** Drop the removed document from this host's navigation stack. */
  readonly onAbandoned: (docId: string) => void;
}

export function useAbandonEmptyDoc({
  docId,
  doc,
  threadCount,
  onAbandoned,
}: AbandonEmptyOptions): void {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  const deps = useRef({ client, queryClient });
  deps.current = { client, queryClient };
  const gone = useRef(onAbandoned);
  gone.current = onAbandoned;

  /*
   * Published on every render rather than on a dependency list: `body`,
   * `title`, the thread count and `extra` all move independently and over SSE,
   * and a stale snapshot here is a document deleted on the strength of a body
   * it no longer has.
   */
  useEffect(() => {
    if (doc === undefined || doc.frontmatter.id !== docId) return;
    publishDoc(docId, {
      type: doc.frontmatter.type,
      title: doc.frontmatter.title,
      body: doc.body,
      threadCount,
      hasExtra: Object.keys(doc.frontmatter.extra).length > 0,
    });
  });

  useLayoutEffect(() => {
    if (docId === "") return undefined;
    retainDoc(docId);
    return () => {
      // Only the last host to let go decides: the same document open in a
      // column reader and in focus mode is displayed until both are done.
      if (!releaseDoc(docId)) return;
      scheduleAbandonEmptyDoc(docId, deps.current.client, deps.current.queryClient);
    };
  }, [docId]);

  useEffect(
    () =>
      subscribeAbandoned((abandonedId) => {
        gone.current(abandonedId);
      }),
    [],
  );

  /**
   * Closing or reloading the tab (SPEC.md §11's "closing the tab").
   *
   * Nothing unmounts, so the teardown above never runs. `pagehide` is the same
   * event `useAutosave` flushes on, and it is deliberately **not** paired with
   * a `beforeunload` prompt: an automatic rule that asks is not automatic.
   */
  useEffect(() => {
    const onLeave = (): void => {
      void abandonEmptyDoc(docId, unloadClient(), deps.current.queryClient);
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
    };
  }, [docId]);
}
