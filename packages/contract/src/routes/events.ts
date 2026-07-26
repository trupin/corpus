import { createRoute, z } from "@hono/zod-openapi";

/**
 * The SSE invalidation stream (SPEC.md §9.2). Documented here so the contract
 * describes the whole HTTP surface, but deliberately *not* part of the generated
 * fetch client: `EventSource` cannot set headers, so the client exposes it
 * through `createEventStream` from `@corpus/contract/client` instead, which is
 * why the bearer token travels as a query parameter (acceptable under the
 * localhost-bind model, SPEC.md §2.1).
 */
export const streamEvents = createRoute({
  method: "get",
  path: "/events",
  tags: ["events"],
  summary: "Server-sent invalidation stream",
  description:
    "Emits `invalidate` events carrying query keys — never data (SPEC.md §2.2 rule 3). 25 s heartbeat, " +
    "dead subscribers pruned. Consume via `createEventStream` from `@corpus/contract/client`.",
  security: [],
  request: {
    query: z.object({
      token: z
        .string()
        .min(1)
        .openapi({
          param: { name: "token", in: "query", required: true },
          description:
            "Workspace bearer token; a query parameter because EventSource cannot set headers.",
        }),
    }),
  },
  responses: {
    200: {
      description: "An open event stream.",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            description:
              "SSE frames; `event: invalidate` frames carry an `InvalidatePayload` as JSON data.",
          }),
        },
      },
    },
    401: { description: "Missing or invalid token." },
  },
});
