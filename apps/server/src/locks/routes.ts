import type { OpenAPIHono } from "@hono/zod-openapi";
import { ACTOR_HEADER, contractRoutes } from "@corpus/contract";
import type { LockService } from "./service.js";

/**
 * Binds the lock handlers to the contract's route definitions.
 *
 * Registration order is inherited from `contractRoutes` and is load-bearing:
 * `POST /api/locks/reap` must be registered before `POST /api/locks/{docId}`, or
 * a reap would be read as an acquire on a document called `reap`. (Nothing could
 * *succeed* that way — `DocumentIdSchema` would reject the id — but the failure
 * would be a 400 where a 200 belongs, which is exactly the silent misrouting the
 * contract's ordering comment warns about.)
 */
export function mountLockRoutes(app: OpenAPIHono, locks: LockService): void {
  app.openapi(contractRoutes.listLocks, async (c) => c.json({ locks: await locks.list() }, 200));

  app.openapi(contractRoutes.reapLocks, async (c) => c.json({ reaped: await locks.reap() }, 200));

  app.openapi(contractRoutes.acquireLock, async (c) => {
    const { docId } = c.req.valid("param");
    const actor = c.req.valid("header")[ACTOR_HEADER];
    // The body is optional in full, so a bare `POST` validates to `{}` and `ttl`
    // stays `undefined` — which the service reads as "the default lease".
    const { ttl } = c.req.valid("json");
    return c.json(await locks.acquire(docId, actor, ttl), 201);
  });

  app.openapi(contractRoutes.releaseLock, async (c) => {
    const { docId } = c.req.valid("param");
    const actor = c.req.valid("header")[ACTOR_HEADER];
    const holder = await locks.release(docId, actor);
    return c.json({ docId, released: true as const, holder }, 200);
  });

  app.openapi(contractRoutes.breakLock, async (c) => {
    const { docId } = c.req.valid("param");
    const actor = c.req.valid("header")[ACTOR_HEADER];
    const { holder } = await locks.forceBreak(docId, actor);
    // `holder` names who *held* it — the banner's "force unlock" needs to say
    // whose lock it just took away.
    return c.json({ docId, released: true as const, holder }, 200);
  });
}
