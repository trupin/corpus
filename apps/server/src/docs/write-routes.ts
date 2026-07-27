// The document mutation surface, bound to the contract's route definitions.
//
// Handlers do three things and nothing else: read the validated request, call
// the verb, serialize the declared response. Every invariant — validation,
// atomic write, anchor reconciliation, auto-commit, synchronous re-projection,
// invalidation — lives in `write.ts` and the verb modules, so no handler can
// forget one.
//
// **Warnings are part of the declared response** (SPEC.md §14, CONTRACT-005):
// every mutation response carries a `warnings` array, empty when nothing went
// wrong. The pipeline is the only thing that decides what goes in it — a handler
// neither invents a warning nor drops one, it serializes what came back.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes, type Warning } from "@corpus/contract";
import { actorOf } from "./actor.js";
import { setArchived } from "./archive.js";
import { createDocument } from "./create.js";
import { deleteDocument } from "./delete.js";
import { moveDocument } from "./move.js";
import { loadDocument, toWireDoc } from "./read.js";
import { updateDocument } from "./update.js";
import { createDocumentMutex, type DocsWorkspace, type MutationResult } from "./write.js";

/**
 * §14 asks a warning to surface three ways — "a warning on the API response, a
 * server log entry, and console visibility". This is the log half, and it is not
 * redundant with the response half: the log survives a client that ignores the
 * field, and it names the document, which a `Warning` on its own does not.
 */
function reportWarnings(workspace: DocsWorkspace, docId: string, result: MutationResult): void {
  for (const warning of result.warnings) {
    workspace.logger.info("mutation completed with a warning", {
      docId,
      code: warning.code,
      detail: warning.detail,
      // The mutation stands regardless; this is drift the operator has to see.
      note: "the file mutation stands; a §14 warning never fails a write",
    });
  }
}

/**
 * The response half. Copied rather than passed through because the pipeline
 * holds its warnings readonly while the wire schema infers a mutable array.
 */
const serializeWarnings = (result: MutationResult): Warning[] => [...result.warnings];

export function mountDocWriteRoutes(app: OpenAPIHono, workspace: DocsWorkspace): void {
  const mutex = createDocumentMutex();

  app.openapi(contractRoutes.getDoc, (c) => {
    const { id } = c.req.valid("param");
    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    return c.json(toWireDoc(workspace.projection, loaded), 200);
  });

  app.openapi(contractRoutes.createDoc, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { doc, result } = await createDocument(workspace, mutex, actor, c.req.valid("json"));
    reportWarnings(workspace, doc.frontmatter.id, result);
    return c.json({ doc, warnings: serializeWarnings(result) }, 201);
  });

  app.openapi(contractRoutes.updateDoc, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { doc, anchors, result } = await updateDocument(
      workspace,
      mutex,
      actor,
      id,
      c.req.valid("json"),
    );
    reportWarnings(workspace, id, result);
    return c.json({ doc, anchors, warnings: serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.moveDoc, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { folder } = c.req.valid("json");
    const { doc, result } = await moveDocument(workspace, mutex, actor, id, folder);
    reportWarnings(workspace, id, result);
    return c.json({ doc, warnings: serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.archiveDoc, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { doc, result } = await setArchived(workspace, mutex, actor, id, true);
    reportWarnings(workspace, id, result);
    return c.json({ doc, warnings: serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.unarchiveDoc, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { doc, result } = await setArchived(workspace, mutex, actor, id, false);
    reportWarnings(workspace, id, result);
    return c.json({ doc, warnings: serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.deleteDoc, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { result, mutation } = await deleteDocument(workspace, mutex, actor, id);
    reportWarnings(workspace, id, mutation);
    return c.json(result, 200);
  });
}
