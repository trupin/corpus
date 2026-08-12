import type { Doc, DocRow, RelatedDoc } from "@corpus/contract";
import {
  CorpusRequestError,
  THREAD_DOC_TYPE,
  useDoc,
  useDocs,
  useRelatedDocs,
  useThread,
  type ThreadView,
} from "@corpus/kit";

/**
 * Everything a reader needs about one document, from four shared queries.
 *
 * Both hosts — the in-column reader and focus mode — call this, so the two can
 * never disagree about what a document *is* while differing about how it is
 * framed. Every query here is cached under a key the server names over SSE, so a
 * rename, an edit or a resolve landing out of band repaints both hosts with no
 * reload and no polling — including **the agent's own writes**, which reach this
 * hook as `["docs", id]` frames exactly as they always have (SPEC.md §9.4).
 * Nothing here ever read lock state, and there is none to read: SPEC.md §7
 * replaced it with a key the writer presents, and §11 makes the board never
 * read-only.
 *
 * The two collection reads are one request each, not one per item:
 * `useDocs({parent})` is the document's threads and `useDocs({references})` is
 * its backlinks (SPEC.md §9.2's `references=` filter, the `links` table).
 * `useRelatedDocs` is the fourth, and the one read that is a *ranking* rather
 * than a filter (SPEC.md §9.2) — which is why it has its own endpoint and cannot
 * ride on the collection query the way backlinks do.
 */

export interface ReaderDoc {
  readonly docId: string;
  readonly doc: Doc | undefined;
  readonly isPending: boolean;
  /** The document is gone — deleted out of band, or a stale navigation entry. */
  readonly isMissing: boolean;
  /** A read failure that is *not* "it does not exist": offline, 500, refused. */
  readonly error: Error | null;
  readonly isArchived: boolean;
  readonly isThread: boolean;
  /** The conversation, for a `type: thread` document. */
  readonly thread: ThreadView | undefined;
  /**
   * The conversation read is still in flight.
   *
   * Distinct from `thread === undefined`, which is also what a *failed* read
   * looks like: a placement that waited on the data would then wait forever,
   * where what it wants is to wait for the answer and then place the
   * conversation — card, error and all (`DocView`'s thread branch).
   */
  readonly threadPending: boolean;
  /** Threads *on* this document (SPEC.md §6), for the 💬 popover and the slots. */
  readonly threads: readonly DocRow[];
  /**
   * That list has **answered** — it is not still in flight.
   *
   * `threads` is `[]` both for a document with no conversations and for one whose
   * list has not landed, and a placement cannot tell those apart from the array
   * alone. It has to: the fold is decided once per conversation, when it is
   * placed, so placing on the empty stand-in makes a wrong answer permanent
   * (`anchors/AnchoredThreads.tsx`). Distinct from `threads.length === 0` for the
   * same reason {@link threadPending} is distinct from `thread === undefined` —
   * and false-on-error for the same reason too, so a failed list moves the reader
   * on rather than holding it.
   */
  readonly threadsSettled: boolean;
  /** Documents referencing this one — the "Referenced by" panel. */
  readonly backlinks: readonly DocRow[];
  /**
   * The ranked related set — the "Related" panel (SPEC.md §11), in the server's
   * order with the server's relation labels, neither re-sorted nor filtered.
   */
  readonly related: readonly RelatedDoc[];
}

function isNotFound(error: unknown): boolean {
  return error instanceof CorpusRequestError && error.status === 404;
}

export function useReaderDoc(docId: string): ReaderDoc {
  const doc = useDoc(docId);
  const isThread = doc.data?.frontmatter.type === THREAD_DOC_TYPE;
  // Only a thread document has a conversation to read; `useThread` is disabled
  // for everything else rather than 404-ing once per note the user opens.
  const thread = useThread(isThread ? docId : undefined);
  const threads = useDocs({ parent: docId, type: THREAD_DOC_TYPE });
  const backlinks = useDocs({ references: docId });
  // A stack entry may name a document the agent deleted, and there is nothing
  // to relate to a document that is not there. Disabled by passing `undefined`
  // rather than by an ad-hoc flag, exactly as `useThread` above — otherwise
  // every `["docs"]` frame the server emits would earn a second 404 for as long
  // as the reader sits on the missing card.
  const related = useRelatedDocs(isNotFound(doc.error) ? undefined : docId);

  return {
    docId,
    doc: doc.data,
    isPending: doc.isPending,
    isMissing: isNotFound(doc.error),
    error: doc.error !== null && !isNotFound(doc.error) ? doc.error : null,
    isArchived: doc.data?.frontmatter.status === "archived",
    isThread,
    thread: thread.data,
    threadPending: isThread && thread.isPending,
    threads: threads.data?.items ?? [],
    threadsSettled: !threads.isPending,
    backlinks: backlinks.data?.items ?? [],
    related: related.data?.related ?? [],
  };
}
