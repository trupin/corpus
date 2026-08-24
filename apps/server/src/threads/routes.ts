// The thread surface, bound to the contract's route definitions (SPEC.md §9.2).
//
// Handlers read the validated request, call the verb, serialize the declared
// response — nothing else. Every invariant (atomic write, auto-commit,
// synchronous re-projection, invalidation, the §8 enqueue decision) lives in the
// verb modules, so no handler can forget one and no two handlers can disagree.
//
// **The two dual-media routes are mounted through the contract's own helpers**
// — `mountCreateThread` and `mountAppendTurn` — never through `app.openapi`.
// That is not a style preference: `@hono/zod-openapi` pushes *every* declared
// media type's validator into the chain when a body is `required: true`, so a
// route mounted the ordinary way rejects both of its own forms. `app.openapi`
// still compiles here and would answer `400` to every JSON `POST /api/threads`
// at runtime, which no type check and no contract test can catch — only a
// request can (CONTRACT-009).

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes, mountAppendTurn, mountCreateThread } from "@corpus/contract";
import { actorOf, reportWarnings, serializeWarnings, type DocumentMutex } from "../docs/index.js";
import type { SemanticRetrieval } from "../semantic/index.js";
import { deleteThreadTurn } from "./cascade.js";
import { threadContextPack } from "./context.js";
import { createThread, threadRequestBody } from "./create.js";
import { answerThreadForm } from "./forms.js";
import { loadThread, toWireThread } from "./read.js";
import { reattachThread } from "./reattach.js";
import { designateResident, releaseResident } from "./resident.js";
import { markThreadSeen } from "./seen.js";
import { setThreadStatus } from "./status.js";
import { assertJobResolvable } from "../docs/create.js";
import { assertRecipientResolvable } from "../queue/scope.js";
import { appendThreadTurn, turnRequestBody } from "./turns.js";
import type { ThreadsWorkspace } from "./workspace.js";

export interface ThreadRoutesOptions {
  /**
   * Retrieval's semantic half (SERVER-045), for the context pack's related
   * excerpts. Handed over at mount time and read **per request**, so the
   * embedded engine `lifecycle.ts` binds *after* the routes are mounted still
   * reaches this handler — a handler that captured a resolved provider here
   * would answer `disabled` forever on the first run that downloads a model.
   */
  readonly semantic?: SemanticRetrieval | undefined;
}

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
  options: ThreadRoutesOptions = {},
): void {
  app.openapi(contractRoutes.getThread, (c) => {
    const { id } = c.req.valid("param");
    return c.json(toWireThread(workspace, loadThread(workspace, id)), 200);
  });

  // A pure read like `search` and `related`: no mutation, no commit, no
  // invalidation. It answers about a document somebody is editing too — refusing
  // to brief an agent on a conversation somebody else is in would be the
  // opposite of useful.
  app.openapi(contractRoutes.getThreadContext, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await threadContextPack(workspace, id, { semantic: options.semantic }), 200);
  });

  mountCreateThread(app, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const input = threadRequestBody(c.req.valid("json"));
    // §7's recipient, refused here for the same reason `job` is refused on the
    // two routes below: the route declares the `422`, and a declared refusal
    // that never fires is a route that accepts a value and ignores it. Before
    // the verb, so "nothing was written" is true of the refusal.
    assertRecipientResolvable(workspace.projection, input.recipient);
    const { thread, anchorId, eventId, result } = await createThread(
      workspace,
      mutex,
      actor,
      input,
    );
    reportWarnings(workspace, thread.id, result);
    return c.json({ thread, anchorId, eventId, warnings: serializeWarnings(result) }, 201);
  });

  mountAppendTurn(app, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const input = turnRequestBody(c.req.valid("json"));
    // A turn appends to a thread that already exists, so it creates no document
    // and records no origin — but the route declares the `422`, and a declared
    // refusal that never fires is §9.2's silent ignore.
    assertJobResolvable(workspace, input.job);
    assertRecipientResolvable(workspace.projection, input.recipient);
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

  // Single media type, so the ordinary mount is correct here — the dual-media
  // hazard above applies only to the two routes that declare both JSON and
  // multipart.
  app.openapi(contractRoutes.respondToForm, async (c) => {
    const { id, ts } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    // A form answer is user-only and creates no document; the job on it
    // attributes the answer to the work that asked the question. Validated for
    // the same reason as the other attribution-only writes.
    assertJobResolvable(workspace, c.req.valid("json").job);
    assertRecipientResolvable(workspace.projection, c.req.valid("json").recipient);
    const { thread, turn, eventId, result } = await answerThreadForm(
      workspace,
      mutex,
      actor,
      id,
      ts,
      c.req.valid("json"),
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

  // Both carry §11's warnings on the response rather than only in the log:
  // resolving rewrites the thread's frontmatter and auto-commits it, so a
  // workspace git hook that refuses the commit leaves the change on disk and
  // uncommitted — drift the person who clicked *Resolve* has to be told about.
  // A `null` result is the no-op case (the thread already had that status):
  // nothing was written, so there is nothing to warn about.
  app.openapi(contractRoutes.resolveThread, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, result } = await setThreadStatus(workspace, mutex, actor, id, "resolved");
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json({ thread, warnings: result === null ? [] : serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.reopenThread, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, result } = await setThreadStatus(workspace, mutex, actor, id, "open");
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json({ thread, warnings: result === null ? [] : serializeWarnings(result) }, 200);
  });

  // Designation and release (SPEC.md §7). Both answer with the thread and its
  // warnings for the reason resolve/reopen do: each rewrites the thread's
  // frontmatter and auto-commits it, so a workspace git hook that refuses the
  // commit leaves the change on disk and uncommitted — drift the person who
  // designated has to be told about. A `null` result is the no-op case
  // (designating the resident the thread already has, or releasing one it does
  // not have): nothing was written, so there is nothing to warn about.
  app.openapi(contractRoutes.designateResident, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    // The body is optional **in full** (CONTRACT-061): a bare `POST` designates
    // a general resident, so the validated value is `undefined` rather than an
    // empty object, and `{}` and no body at all have to mean the same thing.
    const { thread, result } = await designateResident(workspace, mutex, actor, id, {
      ...c.req.valid("json"),
    });
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json({ thread, warnings: result === null ? [] : serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.releaseResident, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, result } = await releaseResident(workspace, mutex, actor, id);
    if (result !== null) reportWarnings(workspace, id, result);
    return c.json({ thread, warnings: result === null ? [] : serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.reattachThread, async (c) => {
    const { id } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    const { thread, anchor, result } = await reattachThread(
      workspace,
      mutex,
      actor,
      id,
      c.req.valid("json"),
    );
    reportWarnings(workspace, id, result);
    return c.json({ thread, anchor, warnings: serializeWarnings(result) }, 200);
  });

  app.openapi(contractRoutes.markThreadSeen, async (c) => {
    const { id } = c.req.valid("param");
    // The body is declared optional in full — a bare POST marks the thread read
    // to its last turn — and the library hands an absent body through as `{}`.
    return c.json(await markThreadSeen(workspace, mutex, id, c.req.valid("json") ?? {}), 200);
  });
}
