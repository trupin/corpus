// The invalidation key vocabulary (SPEC.md §2.2 rule 3).
//
// A key is a **`QueryKey` — an array**, one segment per path component, because
// that is what TanStack Query invalidates on and what the contract's
// `InvalidatePayloadSchema` declares (sprint-004 Adjudication 1). A flat string
// like `"docs/doc_a1b2c3"` is not merely a different spelling: the shipped
// consumer (`createEventStream`) validates every frame against that schema and
// rejects it.
//
// The strings live here rather than in `@corpus/contract` for now; publishing
// them as typed contract surface is a follow-up CONTRACT issue, and the E2E log
// records the emitted vocabulary verbatim so UI-002 can mirror it meanwhile.

import type { QueryKey } from "@corpus/contract";

/** The document collection behind `GET /api/docs` — every list, board column and search. */
export const DOCS_KEY: QueryKey = ["docs"];
/** The `data/docs/` folder tree behind `GET /api/tree`. */
export const TREE_KEY: QueryKey = ["tree"];
/** Queue status and counts (SPEC.md §7). */
export const QUEUE_KEY: QueryKey = ["queue"];
/** The console's job rows; every queue event is a job. */
export const JOBS_KEY: QueryKey = ["jobs"];
/** Live lock banners (SPEC.md §7). */
export const LOCKS_KEY: QueryKey = ["locks"];

export const docKey = (docId: string): QueryKey => ["docs", docId];
export const threadKey = (threadId: string): QueryKey => ["threads", threadId];
export const jobKey = (eventId: string): QueryKey => ["jobs", eventId];
export const lockKey = (docId: string): QueryKey => ["locks", docId];

/**
 * Collapses a batch's keys to one occurrence each, in first-seen order.
 *
 * Order is preserved rather than sorted so a frame reads as "what changed, in
 * the order it was noticed"; identity is structural (two `["docs","doc_a"]`
 * arrays are one key), which is also how the UI's cache compares them.
 */
export function dedupeKeys(keys: Iterable<QueryKey>): QueryKey[] {
  const seen = new Set<string>();
  const out: QueryKey[] = [];
  for (const key of keys) {
    const identity = JSON.stringify(key);
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(key);
  }
  return out;
}
