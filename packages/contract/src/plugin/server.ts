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
 * What a plugin's server routes are handed (SPEC.md §10): typed document
 * services and a namespaced broadcast — never the filesystem, never the
 * database, never git. Every write funnels through the same pipeline core
 * routes use (`validate → write atomically → auto-commit → re-project →
 * broadcast`), so Architecture Decision 2 — the server is the sole writer —
 * holds for plugin routes by construction, not by review.
 *
 * The surface is deliberately the smallest honest one for v1: list, read one,
 * create, update (the verb that reconciles anchors), and the invalidation
 * broadcast. A plugin needing move/archive/delete grows this interface — and
 * the server implementation that satisfies it — rather than opening a side
 * channel.
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
   * Broadcasts `invalidate` over the core SSE stream. Each entry is the key's
   * segments *after* the namespace: `[["notes"], ["notes", id]]` reaches the
   * wire as `["x", "<plugin>", "notes"]` and `["x", "<plugin>", "notes", id]`
   * — exactly what the kit's `pluginKey` builds, so plugin columns refetch
   * with no extra machinery. A key naming a core root is rejected.
   */
  broadcastInvalidate(keys: readonly (readonly QueryKeySegment[])[]): void;
}
