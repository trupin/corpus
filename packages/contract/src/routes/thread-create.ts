import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  MultipartCreateThreadRequestSchema,
  type CreateThreadRequest,
  type MultipartCreateThreadRequest,
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
 * `POST /api/threads` — the second dual-media route, and the wire path for the
 * composer's *Ask* with attachments (SPEC.md §8) and for a selection comment
 * that carries a file (§6). Before it, only Capture could ingest attachments, so
 * *Ask* had no way to send one at all.
 *
 * Everything about the mechanism — why a `required: true` dual-media body cannot
 * be mounted with `app.openapi`, and why the published definition still declares
 * it mandatory — is in `./dual-media.ts`.
 */

/** Media types the route accepts, in the order the document declares them. */
export const THREAD_CREATE_MEDIA_TYPES = DUAL_MEDIA_TYPES;

const createThreadRoute = (required: boolean) =>
  createRoute({
    method: "post",
    path: "/api/threads",
    tags: ["threads"],
    summary: "Create a thread on a selection, a whole document, or standalone",
    description:
      "With a selector, the server writes the anchor entry into the parent's frontmatter and creates " +
      "the thread file atomically (SPEC.md §6). It presents no key (SPEC.md §7): anchoring adds one " +
      "`anchors` entry to the parent and replaces nothing.\n\n" +
      "**The stored anchor's context is the server's, not the caller's.** `exact` is stored " +
      "verbatim, but `prefix`/`suffix` on the request are used for one thing only — saying which " +
      "occurrence a repeated quote means — and are never written as sent: the server reads the " +
      "context off the parent's own bytes around the quote, so the anchor is byte-faithful to the " +
      "file even when the caller could not produce context (SERVER-071). A quote occurring more " +
      "than once with nothing to tell the occurrences apart is a `400`, because guessing one " +
      "would attach the conversation to a passage nobody chose; a quote the document does not " +
      "contain is **not** refused, since §6 calls that anchor orphaned and orphaned is a normal " +
      "state of a living corpus rather than a bad request.\n\n" +
      "Send `application/json` for a plain thread, or `multipart/form-data` to attach files to the " +
      "first turn — the composer's *Ask* with a screenshot (SPEC.md §8). The multipart form takes " +
      "the same repeated `files` part as `POST /api/capture`, names the first turn's prose `text` " +
      "rather than `body`, and carries `selector` as one JSON-encoded part; a first turn may be " +
      "attachment-only, but a request with neither text nor files is a `400`. Multipart bodies are " +
      "built by `uploadCreateThread` in `@corpus/contract/client`, since `openapi-fetch` serialises " +
      "JSON only. Servers mount this route with `mountCreateThread` from `@corpus/contract`, which " +
      "dispatches validation on `content-type`. An upload past the workspace's size caps is a `413`.\n\n" +
      "**A standalone thread is created with a resident, unless the caller says otherwise** " +
      "(SPEC.md §7, rider signed 2026-08-25). Omitting `resident` designates a **general " +
      "resident**, because a conversation is a thing an agent owns and owning it is what happens " +
      "when nobody chose. `{name}` designates that profile, resolved exactly as " +
      "`POST /api/threads/{id}/resident` resolves it. **`null` means no resident at all**, and it " +
      "is the one field on this body where `null` and omitted differ — `parent` and `selector` " +
      "treat them alike, this does not, and a caller spelling a missing variable as `null` gets " +
      "the opposite of the default.\n\n" +
      "**`resident` is not `recipient`.** A recipient routes one message and rewires nothing; a " +
      "designation hands over the conversation and everything that grows out of it. Both may ride " +
      "one request. **A `resident` on a thread with a `parent` is a `400`**: §7 lets only a " +
      "standalone thread designate, since a thread on a document is about that document and a " +
      "resident owns a conversation rather than a passage.",
    request: {
      headers: ActorHeaderSchema,
      body: {
        required,
        description:
          "The thread and its first turn, as JSON or as multipart. Mandatory: the JSON form demands " +
          "`body`, a multipart body carrying neither `text` nor `files` is a `400`, and a thread " +
          "with no first turn is not a thread.",
        content: {
          "application/json": { schema: CreateThreadRequestSchema },
          "multipart/form-data": { schema: MultipartCreateThreadRequestSchema },
        },
      },
    },
    responses: {
      422: UNRESOLVED_REFERENCE_RESPONSE,
      201: jsonContent(
        CreateThreadResponseSchema,
        "The created thread, its anchor, and any enqueued event.",
      ),
      400: VALIDATION_RESPONSE,
      401: UNAUTHORIZED_RESPONSE,
      404: NOT_FOUND_RESPONSE,
      413: PAYLOAD_TOO_LARGE_RESPONSE,
    },
  });

/** The published definition: what `openapi.json` and the generated client see. */
export const createThread = createThreadRoute(true);

/** The twin handed to the library, whose falsy `required` buys content-type dispatch. */
const dispatchingCreateThread = createThreadRoute(false);

/** The union `c.req.valid("json")` / `c.req.valid("form")` hands a handler for this route. */
export type CreateThreadBody = CreateThreadRequest | MultipartCreateThreadRequest;

/**
 * Narrows the union to the multipart form. `files` is multipart-only and always
 * present there (the parser normalises a missing part to an empty array), so its
 * presence is a total discriminator — a handler never has to re-read the
 * `content-type` it was already dispatched on.
 */
export function isMultipartThreadCreate(
  body: CreateThreadBody,
): body is MultipartCreateThreadRequest {
  return "files" in body;
}

/** True when the request declares one of the two forms this route validates. */
export const isSupportedThreadCreateContentType = isSupportedDualMediaContentType;

/** The `400` for a thread-create request that declared no validatable body. */
export const MISSING_THREAD_BODY_ERROR = missingBodyError("A thread");

/**
 * Mounts the thread-create route on `app`, restoring the mandatory body the
 * library drops. The handler is typed exactly as it would be for
 * `app.openapi(contractRoutes.createThread, handler)` — **and a server that
 * keeps using `app.openapi` here will reject both of its own body forms at
 * runtime**, which is the one failure this helper exists to prevent.
 */
export function mountCreateThread<E extends Env>(
  app: OpenAPIHono<E>,
  handler: RouteHandler<typeof createThread, E>,
): void {
  const guarded: RouteHandler<typeof createThread, E> = (c, next) => {
    const contentType = c.req.header("content-type");
    if (!isSupportedThreadCreateContentType(contentType)) {
      return c.json(MISSING_THREAD_BODY_ERROR, 400);
    }

    // The dispatch fills one validation target and leaves the other `{}`, so a
    // handler reading the "wrong" one would silently see an empty body. Both are
    // pointed at the body that actually arrived; which form it is stays readable
    // through `isMultipartThreadCreate`.
    const source = dualMediaSource(contentType);
    c.req.addValidatedData(source === "form" ? "json" : "form", c.req.valid(source));

    return handler(c, next);
  };

  app.openapi(dispatchingCreateThread, guarded);
}
