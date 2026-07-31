import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { toWireEvent } from "./store.js";
import type { QueueService } from "./service.js";

const SECONDS = 1000;

/**
 * Binds the queue handlers to the contract's route definitions. Registration
 * order matters and is inherited from `contractRoutes`: the static segments
 * (`claim-all`, `reap-stale`, `halt`, `resume`, `status`, `idle`) must be
 * registered before `/api/queue/{id}` or an event id would shadow them.
 */
export function mountQueueRoutes(app: OpenAPIHono, queue: QueueService): void {
  app.openapi(contractRoutes.getQueueStatus, async (c) => c.json(await queue.status(), 200));

  app.openapi(contractRoutes.idleQueue, async (c) => {
    const { timeout } = c.req.valid("query");
    const events = await queue.idle({
      timeoutMs: timeout * SECONDS,
      signal: c.req.raw.signal,
    });
    // The window expired (or the queue is halted, or the client went away):
    // `204` with no body is a normal outcome, not an error.
    if (events === undefined) return c.body(null, 204);
    return c.json({ events: events.map(toWireEvent) }, 200);
  });

  app.openapi(contractRoutes.claimAll, async (c) => {
    const events = await queue.claimAll();
    return c.json({ events: events.map(toWireEvent) }, 200);
  });

  // Both arrays, and they are disjoint: `reaped` is what came back to
  // `pending/`, `failed` is what the reap gave up on — an event past its attempt
  // cap, or one whose file no longer parses. The service has always computed
  // both; dropping `failed` here left the CLI unable to report a give-up at all
  // (CONTRACT-007's rider).
  app.openapi(contractRoutes.reapStale, async (c) => {
    const { reaped, failed } = await queue.reapStale();
    return c.json({ reaped, failed }, 200);
  });

  app.openapi(contractRoutes.haltQueue, async (c) => {
    // The body is optional in full, so a bare `POST` validates to `{}` and
    // `reason` stays `undefined` — which `halt` turns into a sentinel with no
    // `reason` key. Passing it through unchanged (never `?? ""`) is what keeps
    // "halted without a reason" distinguishable from "halted for a reason".
    const { reason } = c.req.valid("json");
    return c.json(await queue.halt(reason), 200);
  });
  app.openapi(contractRoutes.resumeQueue, async (c) => c.json(await queue.resume(), 200));

  app.openapi(contractRoutes.completeEvent, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(toWireEvent(await queue.complete(id)), 200);
  });

  app.openapi(contractRoutes.failEvent, async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    return c.json(toWireEvent(await queue.fail(id, reason)), 200);
  });

  // `blockedOn` is required by the contract's body schema, so the handler never
  // has to consider a deferral that names no document — one that did could never
  // re-enter, which is the whole reason the body is mandatory (CONTRACT-021).
  app.openapi(contractRoutes.deferEvent, async (c) => {
    const { id } = c.req.valid("param");
    const { blockedOn, reason } = c.req.valid("json");
    const event = await queue.defer(id, {
      blockedOn,
      ...(reason === undefined ? {} : { deferReason: reason }),
    });
    return c.json(toWireEvent(event), 200);
  });

  app.openapi(contractRoutes.abandonEvent, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(toWireEvent(await queue.abandon(id)), 200);
  });
}
