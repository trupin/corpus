/**
 * What the thread write paths need beyond the document pipeline (SPEC.md §6,
 * §7, §8).
 *
 * A thread mutation *is* a document mutation — it writes markdown, auto-commits,
 * re-projects and invalidates through exactly the same `runMutation` — so this
 * extends {@link DocsWorkspace} rather than restating it. The two additions are
 * the things only threads reach: the queue a `comment.created` goes into, and
 * `.corpus/` for the one piece of thread state that is *not* the corpus (read
 * marks, §7).
 */

import type { DocsWorkspace } from "../docs/index.js";

/** What an enqueue answers with; only the id reaches the wire. */
export interface EnqueuedEvent {
  readonly id: string;
}

export interface EnqueueInput {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
}

/**
 * The seam onto the file-backed queue (SPEC.md §7). Injected rather than
 * imported so a thread test can assert what *would* be enqueued without a queue
 * directory — but in production it is `QueueService.enqueue` itself, never a
 * file drop, because that is the only path that wakes a parked `queue idle`.
 */
export type EnqueueEvent = (input: EnqueueInput) => Promise<EnqueuedEvent>;

export interface ThreadsWorkspace extends DocsWorkspace {
  /** `.corpus/`, which holds `seen.json`. */
  readonly corpusDir: string;
  readonly enqueue: EnqueueEvent;
}

/**
 * Which surface produced an event, for the `source` field of the queue file
 * (SPEC.md §7). The server cannot honestly say "ui" or "cli" — both are HTTP
 * clients of the same endpoint and neither identifies itself — so `source` names
 * the *producing surface* instead, which is information the server actually has.
 */
export const EVENT_SOURCE = {
  thread: "thread",
  capture: "capture",
} as const;

/** The one event type a comment produces (SPEC.md §7, §8). */
export const COMMENT_CREATED = "comment.created";
