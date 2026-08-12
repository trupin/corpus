import type { Actor } from "../actor.js";
import type { QueryKeySegment } from "../query-keys.js";
import type {
  CreateDocRequest,
  Doc,
  DocList,
  DocsQuery,
  UpdateDocRequest,
} from "../schemas/index.js";

/**
 * The server half of the plugin type contract (SPEC.md §10): what a plugin's
 * `server/routes.ts` factory is handed, declared where a plugin may import it.
 *
 * The **interface** lives here; the **implementation** stays in `apps/server`
 * (`src/plugins/context.ts` builds it, `discover.ts` mounts it), which is what
 * keeps the dependency direction intact — the contract knows nothing about the
 * projection, git, or the filesystem, and the server proves it still matches by
 * annotating `createPluginContext`'s return with this type. Drift is therefore
 * a type error on the implementing side, not a silently rotten duplicate on the
 * plugin side (CONTRACT-015).
 */

/** Structured fields attached to one log line — a plain JSON-ish record. */
export type PluginLogFields = Record<string, unknown>;

/**
 * The logging capability a plugin route may use. A deliberately minimal
 * declaration rather than the server's own `Logger`: that type's module also
 * exports sinks that write to `process.stdout`, and the contract is imported by
 * browser bundles (`@corpus/kit` → `apps/ui`). Level gating and the sink are
 * the server's business, so neither appears here; `apps/server`'s `Logger`
 * satisfies this interface structurally.
 */
export interface PluginLogger {
  info(message: string, fields?: PluginLogFields): void;
  debug(message: string, fields?: PluginLogFields): void;
  /** Errors are never gated: a silenced server must still report why it died. */
  error(message: string, fields?: PluginLogFields): void;
}

/**
 * The recompute half of {@link PluginServerContext.mutateDoc}: given the
 * document as it stands *inside* its write lane, return the patch to apply.
 *
 * Synchronous on purpose. The lane is held for the whole call, and a plugin's
 * mutation is always a pure recompute of frontmatter or body from the current
 * document — nothing it needs is awaited. Keeping it synchronous means a plugin
 * cannot park a document's lane on a network call, and it makes "the read and
 * the write see the same document" a property of the type rather than of the
 * caller's discipline. An `async` callback simply does not type-check —
 * `Promise<UpdateDocRequest>` is not an `UpdateDocRequest`.
 */
export type PluginDocMutation = (doc: Doc) => UpdateDocRequest;

/**
 * What a plugin's server routes are handed (SPEC.md §10): typed document
 * services and a namespaced broadcast — never the filesystem, never the
 * database, never git. Every write funnels through the same pipeline core
 * routes use (`validate → write atomically → auto-commit → re-project →
 * broadcast`), so Architecture Decision 2 — the server is the sole writer —
 * holds for plugin routes by construction, not by review.
 *
 * The surface is deliberately the smallest honest one for v1: list, read one,
 * create, update (the verb that reconciles anchors), mutate atomically, and the
 * invalidation broadcast. A plugin needing move/archive/delete grows this
 * interface — and the server implementation that satisfies it — rather than
 * opening a side channel.
 *
 * `updateDoc` and `mutateDoc` are not two ways to do one thing: a patch a
 * plugin already holds goes through `updateDoc`, a patch it has to *derive from
 * the current document* goes through `mutateDoc`, because only the latter reads
 * and writes under one lane. Both stay because the first is the common case and
 * carrying a callback for it would be noise (CONTRACT-019).
 */
export interface PluginServerContext {
  /** The plugin's directory name — its one identity, assigned, never declared. */
  readonly plugin: string;
  readonly logger: PluginLogger;
  readonly now: () => number;
  /** The collection query behind every list — `GET /api/docs`'s engine. */
  listDocs(query: DocsQuery): DocList;
  /** One document, with body and resolved anchors — `GET /api/docs/{id}`'s shape. */
  getDoc(id: string): Doc;
  /** Creates through the core write path: git auto-commit, projection, broadcast. */
  createDoc(actor: Actor, input: CreateDocRequest): Promise<Doc>;
  /** Updates through the core write path — including §6 anchor reconciliation. */
  updateDoc(actor: Actor, id: string, patch: UpdateDocRequest): Promise<Doc>;
  /**
   * The **atomic** read-modify-write: `getDoc(id)` → `mutate(doc)` →
   * `updateDoc(actor, id, patch)`, with all three inside the document's own
   * write lane, so nothing else writes that document in between.
   *
   * This is the only correct way for a plugin to compute a patch *from* the
   * document it is patching. `getDoc` then `updateDoc` is not equivalent: only
   * the write serializes, so two concurrent requests (a browser click and an
   * agent CLI call, or two clicks inside the first write's git-commit window)
   * both read the pre-change document, and the second silently reverts the
   * first after it already answered `200` (PR #11 review, finding 2). Any patch
   * carrying a whole recomputed collection — the todos plugin's `items` array
   * is the reference case — has that shape and belongs here.
   *
   * Semantics, exactly:
   *
   * - **Lane scope.** The lane taken is the one `updateDoc` takes for this
   *   document, held from before the read until after the write completes
   *   (auto-commit and re-projection included). Writes to *other* documents are
   *   unaffected: lanes are per-document, not global.
   * - **The callback sees the document `getDoc` would return**, at the instant
   *   the lane opened — never a value read before queuing — and returns exactly
   *   what `updateDoc` accepts as its `patch`. No new type crosses the plugin
   *   boundary; see {@link PluginDocMutation} for why it is synchronous.
   * - **Throwing aborts, writing nothing.** The error propagates to the plugin's
   *   route handler **unwrapped** — a plugin-defined error (todos'
   *   `TodoItemError`) arrives as itself, so the handler's own status mapping
   *   still applies. The lane is released either way.
   * - **A stale-key refusal is `updateDoc`'s**, unchanged: a write whose `key`
   *   no longer names the document's version is refused with the same error, and
   *   the refusal is part of the write, so the callback may already have run. It
   *   must therefore be a pure recompute — that its result was computed is never
   *   evidence anything was written. **A body patch must carry the key of the
   *   document the callback was handed** (`doc.key`, SPEC.md §7): reading and
   *   writing happen inside one lane here, so that key is current by
   *   construction — which is exactly the claim a key makes.
   * - **A patch failing validation is refused** the way `updateDoc` refuses one.
   * - **Not re-entrant.** The callback must not call this context's write
   *   methods. Being synchronous it could only float their promises anyway, and
   *   a nested `updateDoc`/`mutateDoc` on *this* document would deadlock the
   *   lane it is already holding. `getDoc` would not deadlock but is redundant —
   *   the callback was handed the document. `logger` and `now` are fine.
   * - **Broadcasts are still the plugin's own.** Like `updateDoc`, this
   *   invalidates the core keys through the core write path; a plugin follows up
   *   with `broadcastInvalidate` for its own keys, after the promise resolves.
   *
   * Resolves to the updated document — the same value `updateDoc` resolves to.
   */
  mutateDoc(actor: Actor, id: string, mutate: PluginDocMutation): Promise<Doc>;
  /**
   * Broadcasts `invalidate` over the core SSE stream. Each entry is the key's
   * segments *after* the namespace: `[["notes"], ["notes", id]]` reaches the
   * wire as `["x", "<plugin>", "notes"]` and `["x", "<plugin>", "notes", id]`
   * — exactly what the kit's `pluginKey` builds, so plugin columns refetch
   * with no extra machinery. A key naming a core root is rejected.
   */
  broadcastInvalidate(keys: readonly (readonly QueryKeySegment[])[]): void;
}
