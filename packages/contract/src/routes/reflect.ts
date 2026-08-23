import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ReflectAskResultSchema, ReflectStatusSchema } from "../schemas/reflect.js";
import { jsonContent, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * SPEC.md §7's reflection (rider 9, signed 2026-08-22): the ask, and the clock.
 *
 * One path, two methods, because they are one resource read two ways — *when
 * was the corpus last reflected on*, and *reflect on it now*. Splitting them
 * across two paths would have made the Reflect control read one and write
 * another for no reason a caller could see.
 *
 * **Neither takes a body.** The ask carries nothing because there is nothing to
 * carry: the window is server state, not a parameter, and a caller that could
 * name its own `since` would be asking for a different act than the one §7
 * defines.
 */
export const askReflection = createRoute({
  method: "post",
  path: "/api/workspace/reflect",
  tags: ["workspace"],
  summary: "Ask for a reflection over the whole corpus",
  description:
    "Enqueues a `workspace.reflect` event carrying one timestamp — the corpus's last reflection " +
    "(SPEC.md §7). The event falls in no scope and takes the orchestrator's lane. This is the " +
    "board bar's Reflect control and `corpus reflect`; the other way one happens is the server " +
    "enqueuing it after the quiet window (see `GET /api/workspace/reflect`).\n\n" +
    "**An ask while one is pending is answered with the pending one, never doubled and never " +
    "refused.** Ten people pressing Reflect produce one reflection, and the tenth is told so: " +
    "the response names the event already pending or in progress and sets `pending: true`. " +
    "That is a `202` rather than a `409` because nothing is wrong — the thing the caller wanted " +
    "is already going to happen, and no different body would change the answer.\n\n" +
    "It writes a queue event and no document, so it makes no commit. It still carries the acting " +
    "party, like every other queue verb (`halt`, `complete`, `fail`): the header records who " +
    "asked, which is what the job log and the digest thread report.",
  request: { headers: ActorHeaderSchema },
  responses: {
    202: jsonContent(
      ReflectAskResultSchema,
      "The reflection that will run — newly enqueued, or the one already pending.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const getReflectStatus = createRoute({
  method: "get",
  path: "/api/workspace/reflect",
  tags: ["workspace"],
  summary: "The reflection clock, what is unreflected, and the quiet window",
  description:
    "What the board bar's Reflect control reads (SPEC.md §7, §10): when the corpus was last " +
    "reflected on, whether a reflection is pending, **how many documents are unreflected**, the " +
    "digest thread of the last one, and the configured quiet window.\n\n" +
    "`changed` is a corpus-wide count and is here so the control is **one request rather than a " +
    "list**. It counts documents whose `updated` is later than `reflected`, whose `lastActor` is " +
    "not `agent`, and which are not archived — the same predicate the board applies to mark each " +
    "row, shipped as this package's `isUnreflected` so the count and the marks cannot disagree.\n\n" +
    'Read-only; no acting party. Refetch it on the `["reflect"]` invalidate key (`GET /events`).',
  responses: {
    200: jsonContent(
      ReflectStatusSchema,
      "The clock, the pending reflection, the unreflected count, the last digest, and the window.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});
