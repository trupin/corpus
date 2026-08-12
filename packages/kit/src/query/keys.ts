import {
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  threadKey,
  type QueryKey,
  type QueryKeySegment,
} from "@corpus/contract/client";

/**
 * Every key the kit caches under is built here, and every core shape is built
 * by calling the contract's own builder rather than by writing a literal.
 *
 * That indirection is the whole point. The server announces staleness by naming
 * query keys over SSE (SPEC.md §2.2 rule 3, §9.2); a client that caches under a
 * key no `invalidate` frame ever names type-checks perfectly, passes every unit
 * test, and then serves stale data forever. Re-exporting the contract's
 * builders makes a rename a compile error on both sides at once.
 *
 * Two shapes are the kit's own and deliberately absent from the contract, whose
 * vocabulary is closed at whatever `QUERY_KEY_NAMES` lists and pinned by a test:
 *
 * - {@link HEALTH_KEY} — the liveness probe is a *client* concern. No server
 *   mutation invalidates it; the SSE bridge does, on every connect and every
 *   drop, which is the only honest signal the UI has about reachability.
 * - {@link pluginKey} — the `x/<plugin>/…` namespace of SPEC.md §10. Plugins
 *   ship independently of the contract, so their keys cannot live in a closed
 *   set. The bridge never allowlists core shapes, so these round-trip through
 *   exactly the same invalidation path.
 */

export {
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  threadKey,
  type QueryKey,
  type QueryKeySegment,
};

/**
 * The console strip's server-reachability probe (`GET /api/health`).
 *
 * Kit-owned rather than contract-owned: the contract publishes what the *server*
 * emits, and the server never emits this one.
 */
export const HEALTH_KEY: QueryKey = ["health"];

/** First segment of every plugin key — the `x/<plugin>/…` namespace (SPEC.md §10). */
export const PLUGIN_KEY_PREFIX = "x";

/**
 * Builds a plugin-namespaced key: `pluginKey("todos", "board")` is
 * `["x", "todos", "board"]`. Plugins must build keys through this so a plugin
 * can never collide with a core shape, or with another plugin.
 */
export function pluginKey(plugin: string, ...parts: readonly QueryKeySegment[]): QueryKey {
  return [PLUGIN_KEY_PREFIX, plugin, ...parts];
}

/**
 * A filter record as it appears inside a query key: sorted keys, sorted array
 * members, nothing empty. See {@link canonicalFilter}.
 */
export type CanonicalFilter = Record<string, unknown>;

/**
 * Orders array members deterministically by their JSON encoding.
 *
 * Filters are unordered sets in the query grammar (`tag=a,b` means the same as
 * `tag=b,a`), so their order must not reach the cache key — otherwise a column
 * that re-renders its filters in a different order silently doubles the request
 * rate against an identical result set.
 */
function compareEncoded(left: unknown, right: unknown): number {
  const a = JSON.stringify(left) ?? "";
  const b = JSON.stringify(right) ?? "";
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const members = value.map(canonicalValue).filter((member) => member !== undefined);
    return members.length === 0 ? undefined : members.sort(compareEncoded);
  }
  if (typeof value === "object") {
    const nested = canonicalFilter(value as Record<string, unknown>);
    return Object.keys(nested).length === 0 ? undefined : nested;
  }
  return value;
}

/**
 * Canonicalises a filter object so key identity is value-based.
 *
 * Drops `undefined`, `null`, `""`, empty arrays and empty nested objects; sorts
 * object keys; sorts array members. Unknown filters are **preserved**, so the
 * contract can grow a query parameter without a kit release — the kit does not
 * allowlist the grammar it knows about.
 *
 * TanStack Query already hashes object keys stably, so key ordering is belt and
 * braces; the array ordering and the empty-value drops are not — those change
 * cache identity.
 */
export function canonicalFilter(filter: Readonly<Record<string, unknown>> = {}): CanonicalFilter {
  const canonical: CanonicalFilter = {};
  for (const key of Object.keys(filter).sort()) {
    const value = canonicalValue(filter[key]);
    if (value === undefined) continue;
    canonical[key] = value;
  }
  return canonical;
}

/**
 * The collection key: `["docs", { …canonical filters }]`.
 *
 * Always two segments, even with no filters (`["docs", {}]`), so that every
 * collection variant sits under the `["docs"]` prefix the server emits on every
 * document mutation, and never collides with `docKey(id)` — `{}` is not a
 * document id, so a frame naming `["docs", "doc_x"]` reaches the reader and no
 * list.
 */
export function docsListKey(filter: Readonly<Record<string, unknown>> = {}): QueryKey {
  return [...DOCS_KEY, canonicalFilter(filter)];
}

/**
 * One document's related set: `["docs", <id>, "related"]`.
 *
 * **Under `docKey(id)`, on purpose** (sprint-022 Open Conflict 7). The contract's
 * key vocabulary is closed — `QUERY_KEY_NAMES` is the whole of it, pinned by a
 * test — so a new shape `["related", id]` would be a contract change plus an
 * artifact regeneration, for a query the server already announces. TanStack matches
 * prefixes, and the server emits `["docs"]` on every document and thread
 * mutation and every watcher-projected change out of band, so this key is
 * invalidated by frames that already exist: a `[[ref]]` appearing anywhere in
 * the workspace refreshes the panel with no new vocabulary. The `"related"` tail
 * is what keeps it distinct from the reader's own `["docs", id]`.
 */
export function relatedKey(id: string): QueryKey {
  return [...docKey(id), "related"];
}

/**
 * A ranked search: `["docs", "search", { …canonical params }]`.
 *
 * Under the `["docs"]` prefix for {@link relatedKey}'s reason — ranked hits go
 * stale on exactly the mutations the server already names. `"search"` cannot
 * collide with `docKey(<id>)`: a document id carries a `<prefix>_<suffix>`
 * shape, so no document is ever addressed as `["docs", "search"]`, and the
 * canonical params object keeps two spellings of one query on one cache entry
 * exactly as {@link docsListKey} does.
 */
export function searchKey(params: Readonly<Record<string, unknown>> = {}): QueryKey {
  return [...DOCS_KEY, "search", canonicalFilter(params)];
}

/**
 * One **invocable** skill, addressed by the name it is invoked under:
 * `["docs", "skill", <name>]`.
 *
 * A document, but not one addressable by {@link docKey}: the caller knows the
 * skill's *name* and not its id, and resolving one to the other is itself the
 * query. It sits under the `["docs"]` prefix for {@link relatedKey}'s reason —
 * the server names that prefix on every document mutation and every
 * watcher-projected change, so an edit, an install or a rename of a skill
 * refreshes this entry with no new key vocabulary. `"skill"` cannot collide with
 * `docKey(<id>)`: a document id carries a `<prefix>_<suffix>` shape, so no
 * document is ever addressed as `["docs", "skill"]`.
 */
export function skillByNameKey(name: string): QueryKey {
  return [...DOCS_KEY, "skill", name];
}

/** The console's job-list key: `["jobs", { …canonical params }]`. */
export function jobsListKey(params: Readonly<Record<string, unknown>> = {}): QueryKey {
  return [...JOBS_KEY, canonicalFilter(params)];
}
