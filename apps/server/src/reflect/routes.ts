import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { actorOf } from "../docs/actor.js";
import type { ReflectService } from "./service.js";

/**
 * SPEC.md §7's two reflection routes: the ask, and the clock.
 *
 * One path, two methods (CONTRACT-076). Neither takes a body — the window is
 * server state, not a parameter — and the ask answers `202` whether it enqueued
 * anything or not, which is the whole of what `pending` is for.
 */
export function mountReflectRoutes(app: OpenAPIHono, reflect: ReflectService): void {
  app.openapi(contractRoutes.askReflection, async (c) =>
    c.json(await reflect.ask(actorOf(c.req.valid("header"))), 202),
  );

  app.openapi(contractRoutes.getReflectStatus, (c) => c.json(reflect.status(), 200));
}
