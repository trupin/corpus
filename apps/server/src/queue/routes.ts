import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { resolveOriginFromPayload } from "../jobs/project.js";
import type { ProjectionDb } from "../projection/index.js";
import { NO_ORIGIN, toInProgressSet, type HeldOriginResolver } from "./held.js";
import { toWireEvent } from "./store.js";
import type { QueueService } from "./service.js";

const SECONDS = 1000;

/**
 * Binds the queue handlers to the contract's route definitions. Registration
 * order matters and is inherited from `contractRoutes`: the static segments
 * (`claim-all`, `reap-stale`, `halt`, `resume`, `status`, `idle`) must be
 * registered before `/api/queue/{id}` or an event id would shadow them.
 *
 * `projection` is what lets a held event say where it came from, resolved by
 * `jobs/project.ts`'s single rule (SERVER-061) rather than by a second walk over
 * the payload. It is optional for the same reason every other read is:
 * `createServer` runs without a database in unit tests, and with no projection
 * no document is resolvable — which is exactly what a null origin already means.
 */
export function mountQueueRoutes(
  app: OpenAPIHono,
  queue: QueueService,
  projection?: ProjectionDb,
): void {
  const resolveOrigin: HeldOriginResolver =
    projection === undefined
      ? NO_ORIGIN
      : (payload) => resolveOriginFromPayload(projection, payload);

  app.openapi(contractRoutes.getQueueStatus, async (c) => c.json(await queue.status(), 200));

  // `scope` on both verbs, and `undefined` is not a third behaviour: the
  // contract defaults an omitted one to the orchestrator's lane, so every caller
  // written before lanes existed keeps meaning exactly what it meant. The
  // service applies that default rather than the handler, so the two entry
  // points cannot come to disagree about it.
  app.openapi(contractRoutes.idleQueue, async (c) => {
    const { timeout, scope } = c.req.valid("query");
    const available = await queue.idle({
      timeoutMs: timeout * SECONDS,
      signal: c.req.raw.signal,
      scope,
    });
    // The window expired (or the queue is halted, or the client went away):
    // `204` with no body is a normal outcome, not an error — and a body-less
    // response carries no in-progress set, which is why the field is declared on
    // the `200` alone (SPEC.md §7).
    if (available === undefined) return c.body(null, 204);
    return c.json(
      {
        events: available.events.map(toWireEvent),
        inProgress: toInProgressSet(available.held, resolveOrigin),
      },
      200,
    );
  });

  app.openapi(contractRoutes.claimAll, async (c) => {
    // Two fields, never one: what the agent is being handed, and what the server
    // already believed it was doing. `held` was read before this call moved
    // anything, so the sets are disjoint by construction (SPEC.md §7).
    const claimed = await queue.claimAll({ scope: c.req.valid("query").scope });
    return c.json(
      {
        events: claimed.events.map(toWireEvent),
        inProgress: toInProgressSet(claimed.held, resolveOrigin),
      },
      200,
    );
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
