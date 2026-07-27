import { createRoute, z, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ActorHeaderSchema } from "../schemas/actor.js";
import type { ValidationError } from "../schemas/error.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  MultipartAppendTurnRequestSchema,
  type AppendTurnRequest,
  type MultipartAppendTurnRequest,
} from "../schemas/thread.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * `POST /api/threads/{id}/turns` — the one route in the contract whose body has
 * two media types — together with the mounting helper it needs. Definition and
 * helper live in one module because neither is correct without the other.
 *
 * **The upstream problem.** `@hono/zod-openapi@1.5.1` builds one validator per
 * declared media type and, when `request.body.required` is truthy, pushes *all*
 * of them into the middleware chain unconditionally. A JSON request then has to
 * satisfy the multipart schema as well, and a multipart request the JSON one —
 * so a body declared `required: true` rejects both of its own forms. Only when
 * `required` is falsy does the library wrap each validator in a `content-type`
 * dispatcher, which is the behaviour a dual-media body actually needs.
 *
 * **Why not simply declare it optional.** CONTRACT-004 did, and paid for it: the
 * generated document said the body was omittable, `openapi-typescript` made it
 * an optional argument, and `client.api.POST("/api/threads/{id}/turns")` with no
 * body compiled — a call that can never succeed. The declaration became a lie
 * the type system then propagated to every caller.
 *
 * **The resolution.** The published definition ({@link appendTurn}) keeps
 * `required: true`, so `openapi.json` and the generated client are honest.
 * Mounting goes through {@link mountAppendTurn}, which hands the library the
 * `required: false` twin — buying the content-type dispatch — and puts the
 * mandatoriness back itself: a request carrying neither a JSON nor a multipart
 * `content-type` is rejected with the same `400` the library would have
 * produced, before the handler sees it.
 *
 * The twin is never registered into any published document — the generator
 * builds from `ALL_CONTRACT_ROUTES`, and the server serves that document rather
 * than its app's registry — so `required: false` is confined to one validation
 * chain.
 */

/** Media types the route accepts, in the order the document declares them. */
export const TURN_APPEND_MEDIA_TYPES = ["application/json", "multipart/form-data"] as const;

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
      "`@corpus/contract`, which dispatches validation on `content-type`.",
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
      201: jsonContent(
        AppendTurnResponseSchema,
        "The appended turn and the updated thread summary.",
      ),
      400: VALIDATION_RESPONSE,
      401: UNAUTHORIZED_RESPONSE,
      404: NOT_FOUND_RESPONSE,
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

const isJsonContentType = (contentType: string): boolean =>
  /^application\/([\w.+-]+\+)?json\b/.test(contentType);

const isMultipartContentType = (contentType: string): boolean =>
  contentType.startsWith("multipart/form-data");

/**
 * True when the request declares one of the two forms this route validates.
 * Narrows, so the caller can normalise the header without a second undefined
 * check the guard has already made impossible.
 */
export function isSupportedTurnContentType(contentType: string | undefined): contentType is string {
  if (contentType === undefined) return false;
  const normalized = contentType.trim().toLowerCase();
  return isJsonContentType(normalized) || isMultipartContentType(normalized);
}

/**
 * The `400` for a request that declared no validatable body. Built here rather
 * than delegated to the app's `defaultHook` because the guard runs *before* any
 * validator, so there is no `ZodError` to hand a hook — and because the helper
 * must answer identically on an app that has no hook at all. The shape is the
 * contract's own `ValidationError`, the same one every other `400` uses.
 */
export const MISSING_TURN_BODY_ERROR: ValidationError = {
  code: "bad_request",
  message: "request failed validation",
  issues: [
    {
      path: "body",
      message: `A turn requires a body: send ${TURN_APPEND_MEDIA_TYPES.join(" or ")}.`,
    },
  ],
};

/**
 * Mounts the turn-append route on `app`, restoring the mandatory body the
 * library drops. The handler is typed exactly as it would be for
 * `app.openapi(contractRoutes.appendTurn, handler)`, so a call site reads like
 * every other route's. Validation failures still travel through the app's
 * `defaultHook`, exactly as they do for every other mounted route — the helper
 * only adds the case the library has no validator for.
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

    // The dispatch fills one validation target and leaves the other `{}`, so a
    // handler reading the "wrong" one would silently see an empty turn. Both
    // targets are pointed at the body that actually arrived; which form it is
    // stays readable through `isMultipartTurn`.
    const source = isMultipartContentType(contentType.trim().toLowerCase()) ? "form" : "json";
    c.req.addValidatedData(source === "form" ? "json" : "form", c.req.valid(source));

    return handler(c, next);
  };

  app.openapi(dispatchingAppendTurn, guarded);
}
