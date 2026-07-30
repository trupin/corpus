import {
  CreateDocRequestSchema,
  UpdateDocRequestSchema,
  type CreateDocRequest,
  type Doc,
  type QueryKey,
  type QueryKeySegment,
  type UpdateDocRequest,
} from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import type { z } from "zod";
import {
  createDocument,
  loadDocument,
  queryDocs,
  toWireDoc,
  updateDocument,
  updateDocumentLocked,
  type DocsWorkspace,
  type DocumentMutex,
} from "../docs/index.js";
import { badRequest, toValidationIssues } from "../errors.js";
import type { Logger } from "../logger.js";

/**
 * The server's implementation of the plugin context (SPEC.md §10,
 * PLUGINS-001): typed document services and a namespaced broadcast — never the
 * filesystem, never the database, never git. Every write below funnels through
 * the same pipeline core routes use (`validate → write atomically →
 * auto-commit → re-project → broadcast`), so Architecture Decision 2 — the
 * server is the sole writer — holds for plugin routes by construction, not by
 * review.
 *
 * The **interface** is `@corpus/contract/plugin`'s `PluginServerContext`
 * (CONTRACT-015): a plugin may import only `@corpus/kit` and `@corpus/contract`,
 * so the type a plugin's `server/routes.ts` annotates its parameter with has to
 * be reachable from there. It is re-exported below because this module is where
 * the server's own code has always found it; `createPluginContext`'s annotated
 * return type is what makes a drift between the two a compile error **here**,
 * where the implementation lives.
 */
export type { PluginServerContext } from "@corpus/contract/plugin";

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

  /** The document as `getDoc` would return it — the shape the callback is handed. */
  const readDoc = (id: string): Doc =>
    toWireDoc(
      workspace.projection,
      loadDocument(workspace.workspaceRoot, workspace.projection, id),
    );

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
    getDoc: readDoc,
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
    // The whole read → recompute → write, in one pass of the lane
    // `updateDoc` takes for this document (CONTRACT-019, SERVER-034). Nothing
    // here is a second write path: `updateDocumentLocked` *is* `updateDoc`'s
    // body, minus the `mutex.run` that would deadlock on a lane already held —
    // so the lock guard, the validation, the anchor reconciliation, the commit,
    // the re-projection and the core invalidation are the same code, reached
    // the same way.
    mutateDoc: async (actor, id, mutate) =>
      mutex.run(id, async () => {
        // Read inside the lane, so the callback sees the document as it stands
        // now rather than as it stood when the request queued. A document
        // deleted while this waited raises the same not-found `getDoc` raises.
        const before = readDoc(id);
        // A throw here propagates unwrapped — nothing has been written, and the
        // plugin's own error type reaches its own handler's status mapping.
        // `parseWith` refuses a bad patch exactly as `updateDoc` refuses one:
        // the callback's return value is no more trusted than a request body.
        const parsed: UpdateDocRequest = parseWith(
          UpdateDocRequestSchema,
          mutate(before),
          "plugin doc mutate",
        );
        // The lock guard lives in here, after the callback: the refusal is part
        // of the write, which is why the contract requires the callback to be a
        // pure recompute. The re-read it does is the same document this lane
        // just handed the callback — the lane is what makes that true.
        const { doc } = await updateDocumentLocked(workspace, actor, id, parsed);
        return doc;
      }),
    broadcastInvalidate: (keys) => {
      if (keys.length === 0) return;
      workspace.bus.invalidate(keys.map(namespaced));
    },
  };
}
