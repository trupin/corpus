import type { Doc, DocRow, Lock } from "@corpus/contract";
import {
  CorpusRequestError,
  THREAD_DOC_TYPE,
  useDoc,
  useDocLock,
  useDocs,
  useThread,
  type ThreadView,
} from "@corpus/kit";

/**
 * Everything a reader needs about one document, from four shared queries.
 *
 * Both hosts — the in-column reader and focus mode — call this, so the two can
 * never disagree about what a document *is* while differing about how it is
 * framed. Every query here is cached under a key the server names over SSE, so a
 * rename, an edit, a resolve or a lock landing out of band repaints both hosts
 * with no reload and no polling.
 *
 * The three collection reads are one request each, not one per item:
 * `useDocs({parent})` is the document's threads, `useDocs({references})` is its
 * backlinks (SPEC.md §9.2's `references=` filter, the `links` table), and
 * `useLocks()` is the whole lock set shared by every row and reader on the
 * board.
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
  /** Threads *on* this document (SPEC.md §6), for the 💬 popover and the slots. */
  readonly threads: readonly DocRow[];
  /** Documents referencing this one — the "Referenced by" panel. */
  readonly backlinks: readonly DocRow[];
  /** The edit lock, live over SSE (SPEC.md §7). */
  readonly lock: Lock | null;
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
  const lock = useDocLock(docId);

  return {
    docId,
    doc: doc.data,
    isPending: doc.isPending,
    isMissing: isNotFound(doc.error),
    error: doc.error !== null && !isNotFound(doc.error) ? doc.error : null,
    isArchived: doc.data?.frontmatter.status === "archived",
    isThread,
    thread: thread.data,
    threads: threads.data?.items ?? [],
    backlinks: backlinks.data?.items ?? [],
    lock,
  };
}
