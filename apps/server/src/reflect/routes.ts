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

  /**
   * The switch (SERVER-151; SPEC.md §7's rider signed 2026-08-25).
   *
   * A `null` from the service means the workspace config could not be read —
   * a typo somebody is in the middle of, which is a thing a person has to find.
   * Nothing is written over it and the refusal says which file, because the
   * caller cannot see the server's disk and the path is the whole diagnostic.
   */
  app.openapi(contractRoutes.setReflectQuiet, (c) => {
    const status = reflect.setQuiet(c.req.valid("json").quiet);
    if (status === null) {
      return c.json(
        {
          code: "bad_request" as const,
          message:
            "The workspace config could not be read, so nothing was written to it. " +
            "`.corpus/config.json` is not valid JSON — repair it and try again. The quiet " +
            "window is unchanged.",
          issues: [],
        },
        400,
      );
    }
    return c.json(status, 200);
  });
}
