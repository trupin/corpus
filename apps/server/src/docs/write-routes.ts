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
import { applyBulkAction } from "./bulk.js";
import { createDocument } from "./create.js";
import { deleteDocument } from "./delete.js";
import { moveDocument } from "./move.js";
import { loadDocument, toWireDoc } from "./read.js";
import { updateDocument } from "./update.js";
import {
  createDocumentMutex,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "./write.js";

/**
 * §14 asks a warning to surface three ways — "a warning on the API response, a
 * server log entry, and console visibility". This is the log half, and it is not
 * redundant with the response half: the log survives a client that ignores the
 * field, and it names the document, which a `Warning` on its own does not.
 */
export function reportWarnings(
  workspace: DocsWorkspace,
  docId: string,
  result: MutationResult,
): void {
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
 *
 * Both halves are exported because the **thread** surface owes §14 the same two
 * (CONTRACT-006 put `warnings` on its four response shapes): one definition of
 * what a warning is and one of how it reaches the operator, rather than a second
 * copy in `threads/` that drifts the first time the shape changes.
 */
export const serializeWarnings = (result: MutationResult): Warning[] => [...result.warnings];

/**
 * `mutex` is a *parameter* rather than a local because thread writes share it:
 * anchored thread creation and the deletion cascade rewrite a document's
 * frontmatter, so they contend with `PUT /api/docs/{id}` for the same file and
 * must queue in the same lane (SERVER-006). Two mutexes would serialize each
 * surface against itself and neither against the other.
 */
export function mountDocWriteRoutes(
  app: OpenAPIHono,
  workspace: DocsWorkspace,
  mutex: DocumentMutex = createDocumentMutex(),
): void {
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

  // SPEC.md §4's "One action, one commit" (SERVER-077). Registered here beside
  // the collection's other mutation, and — like every route on this app —
  // matched by the contract's own registration order, in which `/api/docs/bulk`
  // precedes the parameterised document routes.
  app.openapi(contractRoutes.applyBulkAction, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const result = await applyBulkAction(workspace, mutex, actor, c.req.valid("json"));
    // §14's log half, scoped to the **act**: its warnings belong to one commit
    // over a set, so repeating each of them once per changed document would say
    // the same thing seventeen times. Which file a validation warning came from
    // is already in `validateBeforeWrite`'s own path-scoped line.
    for (const warning of result.warnings) {
      workspace.logger.info("mutation completed with a warning", {
        // Each changed document with the verb that changed it: a Save carries a
        // mix (SPEC.md §4), so one `action` for the act would be a lie here in
        // exactly the way it is on the wire (CONTRACT-048).
        changed: result.changed.map((outcome) => `${outcome.id}:${outcome.action}`),
        code: warning.code,
        detail: warning.detail,
        note: "the file mutation stands; a §14 warning never fails a write",
      });
    }
    return c.json(result, 200);
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
