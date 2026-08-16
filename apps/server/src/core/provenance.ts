// SPEC.md §7 scope / §9.2 provenance (SHARED-043, SERVER-110): which
// conversation a piece of work belongs to.
//
// One question, asked in two places for two purposes. **Here** it answers "what
// origin do I stamp on the document this write creates". In SERVER-111 the same
// function answers "what lane do I enqueue this event on". Both are the walk
// from an event to the thread it came from, and they must agree exactly — a
// document filed into one scope while its follow-up work is queued on another is
// a resident that owns the artifact and never hears about it.
//
// Deliberately **pure and synchronous**: it reads the event object it is handed
// and touches no filesystem, so a write path pays one store read for the event
// and nothing else, and the enqueue path pays nothing at all.

import type { QueueEventStatus } from "@corpus/contract";

/**
 * Payload keys that can name where a job came from, most specific first.
 *
 * The order is `jobs/project.ts`'s, and shared with it for the cases where both
 * answer the same question — a `comment.created` event's console row and its
 * origin stamp point at one thread, as they should.
 *
 * **They deliberately diverge on `doc.edited`**, and the comment that used to
 * claim they could not has been corrected (PR #47 re-review). The console
 * resolves such an event to the **document** — "open where this job came from"
 * — while provenance resolves it to that document's **origin thread**, because
 * §7 puts reflection work in the scope of what it reflects on. Two questions,
 * two answers; the shared order is about the keys, not about the destination.
 */
const ORIGIN_KEYS = ["threadId", "parentId", "docId"] as const;

/**
 * Is this raw value an origin?
 *
 * **The one copy.** Five independent spellings of this predicate is how the
 * defect it was written for happened: the read paths were made lenient and the
 * write path was not, so a legacy document reported "unfiled" and silently
 * refused to be filed (PR #47). Every path that reads an `origin` off raw
 * frontmatter — the file parser, the document read, the projection, and the
 * update path's first-writer-wins check — asks here, so they cannot drift
 * apart again.
 */
export const isThreadId = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("th_");

/** That value, or `null` — the shape every read path wants. */
export const originOrNull = (value: unknown): string | null => (isThreadId(value) ? value : null);

/**
 * The thread an event came from, or `null` when it names none.
 *
 * **A thread id in the payload is the answer.** `comment.created` and
 * `form.respond` both name their thread, which is the conversation the work
 * belongs to.
 *
 * **A document id alone is not**, and this is the rule worth stating: a
 * `doc.edited` event carries only a `docId`, so its origin is *the edited
 * document's own origin* — resolved by the caller, which has the document —
 * and `null` when that document has none. That keeps reflection work and
 * everything it produces inside the scope of the document it reflects on,
 * rather than starting a new one. This function returns `null` for that case and
 * the caller supplies the document's origin; it cannot do the lookup itself
 * without reading the corpus, which is precisely what it must not do.
 */
export function resolveOrigin(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ORIGIN_KEYS) {
    const value = record[key];
    if (isThreadId(value)) return value;
  }
  return null;
}

/**
 * The statuses a job may be named by, and the ones it may not.
 *
 * **Claimed, parked and waiting are all legal.** A resident stamps while
 * *holding* its event — that is the whole shape of the loop — so `in-progress`
 * is the ordinary case rather than an edge one, and `deferred` is an event that
 * will come back to the same owner.
 *
 * **A settled event is refused.** `processed`, `failed` and `abandoned` name
 * work that is over, and a write claiming to serve finished work is either a
 * stale job id being reused or a loop that never settled its own event —
 * neither of which should quietly acquire a scope.
 */
export const STAMPABLE_STATUSES: readonly QueueEventStatus[] = [
  "pending",
  "in-progress",
  "deferred",
];

export const isStampable = (status: QueueEventStatus): boolean =>
  STAMPABLE_STATUSES.includes(status);

/**
 * The **document** an event names, when it names no thread — the other half of
 * {@link resolveOrigin}, and the reason that one can stay pure.
 *
 * A `doc.edited` event carries only a `docId`, and §7 puts its work in the
 * scope the *edited document* belongs to. That needs a corpus read, so it is
 * split out here: this says which document to ask about, and the caller (which
 * has the projection) asks.
 */
export function originDocumentOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const docId = (payload as Record<string, unknown>)["docId"];
  return typeof docId === "string" && docId.startsWith("doc_") ? docId : null;
}
