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
// `GET /events` and this emitter all read the same builders. This module
// stays the server's import site, so nothing downstream of `../events/index.js`
// changed, and keeps the one genuinely server-side concern: collapsing a batch
// before it goes on the wire.

import type { QueryKey } from "@corpus/contract";
import { DOCS_KEY, QUEUE_KEY, REFLECT_KEY } from "@corpus/contract";

export {
  AGENTS_KEY,
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  REFLECT_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  threadKey,
} from "@corpus/contract";

/**
 * The two keys whose presence in a frame obliges it to carry `["reflect"]`,
 * by identity rather than by reference.
 */
const OBLIGES_REFLECT: ReadonlySet<string> = new Set([
  JSON.stringify(DOCS_KEY),
  JSON.stringify(QUEUE_KEY),
]);

/**
 * SPEC.md §7's reflection key, applied as the rule the contract publishes for
 * it rather than as an entry in twenty key lists (CONTRACT-076).
 *
 * `GET /api/workspace/reflect` moves on two unrelated things — a document write
 * changes its `changed` count, a queue transition changes `pending`, the clock
 * and the last digest — so its published emitter rule is the union: **name
 * `["reflect"]` wherever `["docs"]` is named, and wherever `["queue"]` is
 * named**. Twenty-two call sites name one of those two, and a rule that has to
 * be remembered at each of them is the defect SERVER-115 spent seven sites
 * fixing. So it is applied **once, at the bus** — the single seam every emit
 * passes through on its way to `GET /events` — which is also what the contract
 * asks for in as many words: "an emitter can follow it without knowing what a
 * reflection is, and a write added later inherits it".
 *
 * The two named keys are the **collection** spellings and nothing else. A
 * `["docs", docId]` on its own is one open reader's row going stale, and every
 * mutation that emits one emits `["docs"]` beside it — so matching the
 * parameterised shape would add nothing and would make the rule harder to state.
 *
 * "And no others": a frame that names neither is left exactly as it was.
 */
export function withReflectKey(keys: readonly QueryKey[]): readonly QueryKey[] {
  const obliged = keys.some((key) => OBLIGES_REFLECT.has(JSON.stringify(key)));
  return obliged ? [...keys, REFLECT_KEY] : keys;
}

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
