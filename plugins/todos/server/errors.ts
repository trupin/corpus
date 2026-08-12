import { z } from "zod";
import { TodoItemError } from "../items.js";

/**
 * How a plugin route answers a failure.
 *
 * A plugin may import only `@corpus/kit` and `@corpus/contract` (SPEC.md §10),
 * so `apps/server`'s `HttpError` and its `errorResponse` are out of reach — but
 * the *wire* shape is not: the contract's `ApiError` is `{code, message, …}` on
 * every route, and a plugin route that invented its own error body would be the
 * one part of the API the CLI could not render.
 *
 * So failures are translated here rather than thrown past the mount:
 *
 * - a {@link TodoItemError} is this plugin's own refusal, with the status it
 *   chose (`400` for a malformed or out-of-range write, `409` for the
 *   concurrency guard);
 * - anything the plugin **context** threw — a `404` from `getDoc`, a `409`
 *   `stale_key` refusal from a write whose key no longer names the document's
 *   version (SPEC.md §7), a `400` from the write path's own validation — is
 *   already an HTTP-shaped error, recognised structurally and passed through
 *   with its status and body intact, so a refused write still reads as
 *   `409 stale_key` and not as an opaque plugin failure;
 * - anything else is re-thrown, so the server's `onError` logs it as the
 *   genuine `500` it is instead of this module inventing a friendly message for
 *   a bug.
 */

/** `apps/server`'s `HttpError`, recognised by shape rather than by import. */
const HttpishErrorSchema = z.object({
  status: z.number().int().min(400).max(599),
  body: z.looseObject({ code: z.string().min(1), message: z.string() }),
});

export interface PluginErrorResponse {
  readonly status: number;
  readonly body: { readonly code: string; readonly message: string };
}

/** The status and body a thrown value should become, or `null` to re-throw. */
export function translateThrown(error: unknown): PluginErrorResponse | null {
  if (error instanceof TodoItemError) {
    return {
      status: error.status,
      body: { code: error.status === 409 ? "conflict" : "bad_request", message: error.message },
    };
  }
  const httpish = HttpishErrorSchema.safeParse(error);
  if (httpish.success) {
    const { code, message } = httpish.data.body;
    return { status: httpish.data.status, body: { code, message } };
  }
  return null;
}

/** Runs a handler, translating its failures into the contract's error body. */
export async function answering(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const translated = translateThrown(error);
    if (translated === null) throw error;
    // A plain `Response` rather than `c.json`: Hono's typed helper narrows the
    // status to its `ContentfulStatusCode` union, and a pass-through translator
    // must not have to re-derive that union to forward a status it was handed.
    return new Response(JSON.stringify(translated.body), {
      status: translated.status,
      headers: { "content-type": "application/json" },
    });
  }
}
