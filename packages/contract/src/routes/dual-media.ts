import type { ValidationError } from "../schemas/error.js";

/**
 * The machinery shared by every route whose body has two media types — today
 * `POST /api/threads/{id}/turns` and `POST /api/threads`.
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
 * an optional argument, and a call with no body at all compiled — a call that
 * can never succeed. The declaration became a lie the type system then
 * propagated to every caller.
 *
 * **The resolution.** Each such route is built by a factory taking `required` as
 * a *parameter*, so the published definition and the mountable twin share one
 * type and differ in a runtime flag alone. The published one keeps
 * `required: true`, so `openapi.json` and the generated client are honest; each
 * route's own `mount*` helper hands the library the permissive twin — buying the
 * content-type dispatch — and puts the mandatoriness back itself.
 *
 * The twin is never registered into any published document: the generator builds
 * from `ALL_CONTRACT_ROUTES`, and the server serves that document rather than its
 * app's registry, so `required: false` is confined to one validation chain.
 *
 * **What this module deliberately does not export: a generic `mountDualMedia`.**
 * It was written and reverted. `@hono/zod-openapi`'s handler type is a
 * conditional over the route's `responses`, and over an unresolved
 * `R extends RouteConfig` neither `c.json(error, 400)` nor `c.req.valid(target)`
 * can be typed — the conditional stays unevaluated and every call is an error
 * (TS2322/TS2345 at the guard's three lines). The concrete per-route helpers
 * below the two definitions are twelve lines each and typecheck exactly because
 * their route type is resolved. Shared here is everything that does not touch
 * Hono's generics.
 */

/** The two media types a dual-media body accepts, in the order the document declares them. */
export const DUAL_MEDIA_TYPES = ["application/json", "multipart/form-data"] as const;

export const isJsonContentType = (contentType: string): boolean =>
  /^application\/([\w.+-]+\+)?json\b/.test(contentType);

export const isMultipartContentType = (contentType: string): boolean =>
  contentType.startsWith("multipart/form-data");

/**
 * True when the request declares one of the two forms a dual-media route
 * validates. Narrows, so the caller can normalise the header without a second
 * undefined check the guard has already made impossible.
 */
export function isSupportedDualMediaContentType(
  contentType: string | undefined,
): contentType is string {
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
export const missingBodyError = (what: string): ValidationError => ({
  code: "bad_request",
  message: "request failed validation",
  issues: [
    {
      path: "body",
      message: `${what} requires a body: send ${DUAL_MEDIA_TYPES.join(" or ")}.`,
    },
  ],
});

/**
 * Which validation target the arrived body filled. The library's dispatch fills
 * one and leaves the other `{}`, so a handler reading the "wrong" one would
 * silently see an empty body; each `mount*` helper uses this to point both
 * targets at the body that actually arrived.
 */
export const dualMediaSource = (contentType: string): "form" | "json" =>
  isMultipartContentType(contentType.trim().toLowerCase()) ? "form" : "json";
