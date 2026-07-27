// The thread surface, bound to the contract's route definitions (SPEC.md §9.2).
//
// Handlers read the validated request, call the verb, serialize the declared
// response — nothing else. Every invariant (atomic write, auto-commit,
// synchronous re-projection, invalidation, the §8 enqueue decision) lives in the
// verb modules, so no handler can forget one and no two handlers can disagree.
//
// `POST /api/threads/{id}/turns` is mounted through the contract's own
// `mountAppendTurn` rather than `app.openapi`: it is the one route with two
// media types, and the helper is what gives the library its content-type
// dispatch back without publishing a body the document calls optional.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes, mountAppendTurn } from "@corpus/contract";
import { actorOf, reportWarnings, serializeWarnings, type DocumentMutex } from "../docs/index.js";
import { deleteThreadTurn } from "./cascade.js";
import { createThread } from "./create.js";
import { loadThread, toWireThread } from "./read.js";
import { markThreadSeen } from "./seen.js";
import { setThreadStatus } from "./status.js";
import { appendThreadTurn, turnRequestBody } from "./turns.js";
import type { ThreadsWorkspace } from "./workspace.js";

/**
 * `mutex` is shared with the document surface, not private to this one: anchored
 * creation and the deletion cascade rewrite a *document's* frontmatter, so they
 * contend with `PUT /api/docs/{id}` for the same file and must queue in the same
 * lane. Two mutexes would serialize each surface against itself and neither
 * against the other, which is the same as having none.
 */
export function mountThreadRoutes(
  app: OpenAPIHono,
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
): void {
  app.openapi(contractRoutes.getThread, (c) => {
    const { id } = c.req.valid("param");
    return c.json(toWireThread(loadThread(workspace, id)), 200);
  });

  app.openapi(contractRoutes.createThread, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { thread, anchorId, eventId, result } = await createThread(
      workspace,
      mutex,
      actor,
      c.req.valid("json"),
    );
    reportWarnings(workspace, thread.id, result);
    return c.json({ thread, anchorId, eventId, warnings: serializeWarnings(result) }, 201);
  });

  mountAppendTurn(app, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const input = turnRequestBody(c.req.valid("json"));
    const { thread, turn, eventId, result } = await appendThreadTurn(
      workspace,
      mutex,
      actor,
      id,
      input,
    );
    reportWarnings(workspace, id, result);
    return c.json({ thread, turn, eventId, warnings: serializeWarnings(result) }, 201);
  });

  app.openapi(contractRoutes.deleteTurn, async (c) => {
    const { id, ts } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { result, mutation } = await deleteThreadTurn(workspace, mutex, actor, id, ts);
    reportWarnings(workspace, id, mutation);
    return c.json(result, 200);
  });

  app.openapi(contractRoutes.resolveThread, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, result } = await setThreadStatus(workspace, mutex, actor, id, "resolved");
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json(thread, 200);
  });

  app.openapi(contractRoutes.reopenThread, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, result } = await setThreadStatus(workspace, mutex, actor, id, "open");
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json(thread, 200);
  });

  app.openapi(contractRoutes.markThreadSeen, async (c) => {
    const { id } = c.req.valid("param");
    // The body is declared optional in full — a bare POST marks the thread read
    // to its last turn — and the library hands an absent body through as `{}`.
    return c.json(await markThreadSeen(workspace, mutex, id, c.req.valid("json") ?? {}), 200);
  });
}
