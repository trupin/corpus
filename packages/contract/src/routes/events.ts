import { createRoute, z } from "@hono/zod-openapi";
import { describeQueryKeyVocabulary, QUERY_KEY_NAMES } from "../query-keys.js";
import { VALIDATION_RESPONSE } from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

/**
 * The SSE invalidation stream (SPEC.md §9.2). Documented here so the contract
 * describes the whole HTTP surface, but deliberately *not* part of the generated
 * fetch client: `EventSource` cannot set headers, so the client exposes it
 * through `createEventStream` from `@corpus/contract/client` instead, which is
 * why the bearer token travels as a query parameter.
 *
 * **The token-in-query transport is a decided posture, not an oversight
 * (CONTRACT-014).** Accepted for v1, on the localhost-bind model's terms
 * (SPEC.md §2.1, Architecture Decision 5): the server binds `127.0.0.1` in a
 * single-user system, the only parties who can observe the URL are processes of
 * the same user on the same machine — which could equally read the token from
 * `.corpus/` on disk — and the classic query-string leak vectors do not apply
 * here (no `Referer` leaves the page for a third party over an SSE request, no
 * shared proxy sits on loopback, browser history does not record `EventSource`
 * URLs). The one leak channel the *client* itself creates — its own error
 * messages, which callers are expected to log — redacts the token
 * (`createEventStream`).
 *
 * The boundary is as explicit as the acceptance: this transport is
 * **localhost-only**. A remote-server deployment must not reuse it — query
 * strings transit proxies and access logs in clear — and the committed
 * migration is a short-lived, single-use ticket minted over an authenticated
 * `POST`, or cookie transport, swapped in behind `createEventStream` without
 * changing its signature. Deciding that *before* remote setups arrive is this
 * note's whole purpose.
 */
export const streamEvents = createRoute({
  method: "get",
  path: "/events",
  tags: ["events"],
  summary: "Server-sent invalidation stream",
  description:
    "Emits `invalidate` events carrying query keys — never data (SPEC.md §2.2 rule 3). 25 s heartbeat, " +
    "dead subscribers pruned. Consume via `createEventStream` from `@corpus/contract/client`.\n\n" +
    `The key vocabulary is **closed** — these ${QUERY_KEY_NAMES.length} shapes and no others. ` +
    "Constants and helpers that " +
    "build them are published as `QUERY_KEY_VOCABULARY` and friends from `@corpus/contract` and " +
    "`@corpus/contract/client`, so the emitter and the client bridge share one source rather than " +
    "two copies that drift.\n\n" +
    "**An emitter names every key a route carrying the changed fact is cached under, not the key " +
    "of the route the fact is named after** — so several of these travel in frames named after " +
    "some other resource, and each entry below says which and why:\n\n" +
    describeQueryKeyVocabulary(),
  security: [],
  request: {
    query: z.object({
      token: openapi(z.string().min(1), {
        param: { name: "token", in: "query", required: true },
        description:
          "Workspace bearer token; a query parameter because EventSource cannot set headers. " +
          "Accepted for v1 under the localhost bind (SPEC.md §2.1) — a remote-server deployment " +
          "must replace this transport (see the route's contract docblock) before leaving loopback.",
      }),
    }),
  },
  responses: {
    200: {
      description: "An open event stream.",
      content: {
        "text/event-stream": {
          schema: openapi(z.string(), {
            description:
              "SSE frames; `event: invalidate` frames carry an `InvalidatePayload` as JSON data.",
          }),
        },
      },
    },
    400: VALIDATION_RESPONSE,
    401: { description: "Missing or invalid token." },
  },
});
