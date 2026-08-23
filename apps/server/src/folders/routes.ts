// The folder surface, bound to the contract's route definitions (SPEC.md §9.2,
// rider 7).
//
// Handlers do three things and nothing else: read the validated request, call
// the act, serialize the declared response. The path grammar, the refusal for
// `to` inside `from` and the shape of every result are the contract's
// (`packages/contract/src/schemas/folders.ts`) and are never restated here.
//
// **No `job` field, and so no `422`.** The contract leaves both out on purpose
// (CONTRACT-058's vacuity rule: never declare a refusal you will not emit), and
// building this side gave no reason to want one — §9.2's provenance is recorded
// for a document a job **creates**, and none of these four creates anything.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { actorOf } from "../docs/actor.js";
import type { DocsWorkspace, DocumentMutex } from "../docs/write.js";
import { deleteFolder, renameFolder, setFolderArchived } from "./acts.js";

/**
 * `mutex` is a parameter for the reason the document surface's is: a folder act
 * writes the same files `PUT /api/docs/{id}` writes, so the two must queue in
 * one set of lanes rather than race in two.
 */
export function mountFolderRoutes(
  app: OpenAPIHono,
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
): void {
  app.openapi(contractRoutes.renameFolder, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { from, to } = c.req.valid("json");
    return c.json(await renameFolder(workspace, mutex, actor, from, to), 200);
  });

  app.openapi(contractRoutes.archiveFolder, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { path } = c.req.valid("json");
    return c.json(await setFolderArchived(workspace, mutex, actor, path, true), 200);
  });

  app.openapi(contractRoutes.unarchiveFolder, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { path } = c.req.valid("json");
    return c.json(await setFolderArchived(workspace, mutex, actor, path, false), 200);
  });

  app.openapi(contractRoutes.deleteFolder, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { path } = c.req.valid("json");
    return c.json(await deleteFolder(workspace, mutex, actor, path), 200);
  });
}
