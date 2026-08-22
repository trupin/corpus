import { createRoute, z, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  MultipartAppendTurnRequestSchema,
  type AppendTurnRequest,
  type MultipartAppendTurnRequest,
} from "../schemas/thread.js";
import {
  DUAL_MEDIA_TYPES,
  dualMediaSource,
  isSupportedDualMediaContentType,
  missingBodyError,
} from "./dual-media.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  PAYLOAD_TOO_LARGE_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
  UNRESOLVED_REFERENCE_RESPONSE,
} from "./responses.js";

/**
 * `POST /api/threads/{id}/turns` — one of the two routes whose body carries two
 * media types — together with the mounting helper it needs. Definition and
 * helper live in one module because neither is correct without the other; the
 * mechanism it shares with `./thread-create.ts` lives in `./dual-media.ts`,
 * which also explains why a dual-media body cannot simply be mounted with
 * `app.openapi`.
 */

/** Media types the route accepts, in the order the document declares them. */
export const TURN_APPEND_MEDIA_TYPES = DUAL_MEDIA_TYPES;

const ThreadIdParamSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

/**
 * Builds the route. `required` is a *parameter* rather than a literal so both
 * forms share one type — the published route and the mountable twin differ in a
 * runtime flag and in nothing else, which is what lets a handler written against
 * one be mounted against the other with no cast.
 */
const createAppendTurnRoute = (required: boolean) =>
  createRoute({
    method: "post",
    path: "/api/threads/{id}/turns",
    tags: ["threads"],
    summary: "Append a turn to a thread",
    description:
      "The server owns the turn format and guarantees timestamps are unique and monotonic within the " +
      "thread (SPEC.md §6). Send `application/json` for a plain turn, or `multipart/form-data` to " +
      "attach files — a turn may be attachment-only, but one carrying neither text nor files is a " +
      "`400`. Multipart bodies are built by `uploadTurn` in `@corpus/contract/client`, since " +
      "`openapi-fetch` serialises JSON only. Servers mount this route with `mountAppendTurn` from " +
      "`@corpus/contract`, which dispatches validation on `content-type`. An upload past the " +
      "workspace's size caps is a `413`.\n\n" +
      "**A form fence in an agent's turn is validated here.** When the actor is the agent, a turn " +
      "whose ```` ```form ```` block does not parse against the grammar — unreadable YAML, a " +
      "fourth field kind, duplicate questions, a duplicate option, a `write` field carrying " +
      "`options`, a question or option carrying a newline — is a `400` and does not reach disk " +
      "through this route.\n\n" +
      "**What that is not.** It is not a guarantee that every form fence on disk parses, and a " +
      "client must not treat it as one. Two limits are deliberate: a turn from any other actor " +
      "is not checked, because §6 makes a form something an *agent* turn carries and a person " +
      "quoting a form fence in a reply is quoting rather than asking; and this is not the only " +
      "route that writes a turn — `POST /api/threads` creates a thread with its first turn and " +
      "does not run this check. So the reader's rule (§10: an unreadable form renders as the " +
      "visibly broken code block it is, never as a partial set of controls) is the safety net " +
      "for every fence this endpoint did not vet — a hand-edited file, an older server, a " +
      "person's quoted block, a thread's first turn — and not a formality.",
    request: {
      params: ThreadIdParamSchema,
      headers: ActorHeaderSchema,
      body: {
        required,
        description:
          "The turn, as JSON or as multipart. Mandatory: the JSON form demands `body`, a multipart " +
          "body carrying neither `text` nor `files` is a `400`, and a request with no body at all " +
          "is not a call anyone means to make.",
        content: {
          "application/json": { schema: AppendTurnRequestSchema },
          "multipart/form-data": { schema: MultipartAppendTurnRequestSchema },
        },
      },
    },
    responses: {
      422: UNRESOLVED_REFERENCE_RESPONSE,
      201: jsonContent(
        AppendTurnResponseSchema,
        "The appended turn and the updated thread summary.",
      ),
      400: VALIDATION_RESPONSE,
      401: UNAUTHORIZED_RESPONSE,
      404: NOT_FOUND_RESPONSE,
      413: PAYLOAD_TOO_LARGE_RESPONSE,
    },
  });

/** The published definition: what `openapi.json` and the generated client see. */
export const appendTurn = createAppendTurnRoute(true);

/** The twin handed to the library, whose falsy `required` buys content-type dispatch. */
const dispatchingAppendTurn = createAppendTurnRoute(false);

/** The union `c.req.valid("json")` / `c.req.valid("form")` hands a handler for this route. */
export type AppendTurnBody = AppendTurnRequest | MultipartAppendTurnRequest;

/**
 * Narrows the union to the multipart form. `files` is multipart-only and
 * required there, so its presence is a total discriminator — a handler never has
 * to re-read the `content-type` it was already dispatched on.
 */
export function isMultipartTurn(body: AppendTurnBody): body is MultipartAppendTurnRequest {
  return "files" in body;
}

/**
 * True when the request declares one of the two forms this route validates.
 * Narrows, so the caller can normalise the header without a second undefined
 * check the guard has already made impossible.
 */
export const isSupportedTurnContentType = isSupportedDualMediaContentType;

/** The `400` for a turn-append request that declared no validatable body. */
export const MISSING_TURN_BODY_ERROR = missingBodyError("A turn");

/**
 * Mounts the turn-append route on `app`, restoring the mandatory body the
 * library drops. The handler is typed exactly as it would be for
 * `app.openapi(contractRoutes.appendTurn, handler)`, so a call site reads like
 * every other route's. Validation failures still travel through the app's
 * `defaultHook`, exactly as they do for every other mounted route.
 */
export function mountAppendTurn<E extends Env>(
  app: OpenAPIHono<E>,
  handler: RouteHandler<typeof appendTurn, E>,
): void {
  const guarded: RouteHandler<typeof appendTurn, E> = (c, next) => {
    const contentType = c.req.header("content-type");
    if (!isSupportedTurnContentType(contentType)) {
      return c.json(MISSING_TURN_BODY_ERROR, 400);
    }

    const source = dualMediaSource(contentType);
    c.req.addValidatedData(source === "form" ? "json" : "form", c.req.valid(source));

    return handler(c, next);
  };

  app.openapi(dispatchingAppendTurn, guarded);
}
