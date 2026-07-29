import {
  CreateDocRequestSchema,
  UpdateDocRequestSchema,
  type Actor,
  type CreateDocRequest,
  type Doc,
  type DocList,
  type DocsQuery,
  type QueryKey,
  type QueryKeySegment,
  type UpdateDocRequest,
} from "@corpus/contract";
import type { z } from "zod";
import {
  createDocument,
  loadDocument,
  queryDocs,
  toWireDoc,
  updateDocument,
  type DocsWorkspace,
  type DocumentMutex,
} from "../docs/index.js";
import { badRequest, toValidationIssues } from "../errors.js";
import type { Logger } from "../logger.js";

/**
 * What a plugin's server routes are handed (SPEC.md §10, PLUGINS-001): typed
 * document services and a namespaced broadcast — never the filesystem, never
 * the database, never git. Every write below funnels through the same pipeline
 * core routes use (`validate → write atomically → auto-commit → re-project →
 * broadcast`), so Architecture Decision 2 — the server is the sole writer —
 * holds for plugin routes by construction, not by review.
 *
 * The surface is deliberately the smallest honest one for v1: list, read one,
 * create, update (the verb that reconciles anchors), and the invalidation
 * broadcast. A plugin needing move/archive/delete grows this file, not a
 * side channel.
 */

/**
 * First segment of every plugin invalidation key — the `x/<plugin>/…`
 * namespace of SPEC.md §10. Byte-identical to `PLUGIN_KEY_PREFIX` in
 * `packages/kit/src/query/keys.ts` (`pluginKey(plugin, ...parts)` builds
 * `["x", plugin, ...parts]`); the server cannot import the kit, so the pinning
 * lives in `context.test.ts` instead.
 */
export const PLUGIN_KEY_PREFIX = "x";

/**
 * The roots of the core query-key vocabulary (`@corpus/contract`'s closed nine
 * shapes, plus the kit-owned `health`). A plugin key may name none of them:
 * core keys are broadcast by the core write path itself — which a plugin write
 * already goes through — so a plugin never needs to, and must not be able to,
 * invalidate core queries directly.
 */
const CORE_KEY_ROOTS: ReadonlySet<string> = new Set([
  "docs",
  "tree",
  "threads",
  "queue",
  "jobs",
  "locks",
  "health",
]);

export interface PluginServerContext {
  /** The plugin's directory name — its one identity, assigned, never declared. */
  readonly plugin: string;
  readonly logger: Logger;
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

export interface PluginContextDeps {
  readonly plugin: string;
  readonly workspace: DocsWorkspace;
  readonly mutex: DocumentMutex;
  readonly logger: Logger;
  readonly now: () => number;
}

/** Parses at the trust boundary: plugin routes hand over HTTP-derived input. */
function parseWith<Output>(schema: z.ZodType<Output>, value: unknown, what: string): Output {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`${what} failed validation`, toValidationIssues(result.error, "body"));
  }
  return result.data;
}

export function createPluginContext(deps: PluginContextDeps): PluginServerContext {
  const { plugin, workspace, mutex, logger, now } = deps;

  const namespaced = (parts: readonly QueryKeySegment[]): QueryKey => {
    const first = parts[0];
    if (first === undefined) {
      throw new Error(`plugin ${plugin} broadcast an empty invalidation key`);
    }
    if (typeof first === "string" && (CORE_KEY_ROOTS.has(first) || first === PLUGIN_KEY_PREFIX)) {
      throw new Error(
        `plugin ${plugin} may not invalidate "${first}" — plugin keys are namespaced ` +
          `${PLUGIN_KEY_PREFIX}/${plugin}/…; core keys are broadcast by the core write path itself`,
      );
    }
    return [PLUGIN_KEY_PREFIX, plugin, ...parts];
  };

  return {
    plugin,
    logger,
    now,
    listDocs: (query) => queryDocs(workspace.projection, query, now()),
    getDoc: (id) =>
      toWireDoc(
        workspace.projection,
        loadDocument(workspace.workspaceRoot, workspace.projection, id),
      ),
    createDoc: async (actor, input) => {
      const parsed: CreateDocRequest = parseWith(
        CreateDocRequestSchema,
        input,
        "plugin doc create",
      );
      const { doc } = await createDocument(workspace, mutex, actor, parsed);
      return doc;
    },
    updateDoc: async (actor, id, patch) => {
      const parsed: UpdateDocRequest = parseWith(
        UpdateDocRequestSchema,
        patch,
        "plugin doc update",
      );
      const { doc } = await updateDocument(workspace, mutex, actor, id, parsed);
      return doc;
    },
    broadcastInvalidate: (keys) => {
      if (keys.length === 0) return;
      workspace.bus.invalidate(keys.map(namespaced));
    },
  };
}
