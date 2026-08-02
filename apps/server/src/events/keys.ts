// The invalidation key vocabulary (SPEC.md §2.2 rule 3).
//
// A key is a **`QueryKey` — an array**, one segment per path component, because
// that is what TanStack Query invalidates on and what the contract's
// `InvalidatePayloadSchema` declares (sprint-004 Adjudication 1). A flat string
// like `"docs/doc_a1b2c3"` is not merely a different spelling: the shipped
// consumer (`createEventStream`) validates every frame against that schema and
// rejects it.
//
// The shapes themselves are **no longer defined here**: they are the contract's
// (`@corpus/contract` → `query-keys.ts`, the follow-up CONTRACT issue this file
// used to promise), which is what makes "the published set is the emitted set"
// true by construction — the UI's SSE bridge, the OpenAPI description of
// `GET /events` and this emitter all read the same nine builders. This module
// stays the server's import site, so nothing downstream of `../events/index.js`
// changed, and keeps the one genuinely server-side concern: collapsing a batch
// before it goes on the wire.

import type { QueryKey } from "@corpus/contract";

export {
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  LOCKS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  lockKey,
  threadKey,
} from "@corpus/contract";

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
