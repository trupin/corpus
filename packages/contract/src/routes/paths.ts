/**
 * Route path templates a consumer needs **without** the route definitions behind
 * them.
 *
 * A route definition drags `@hono/zod-openapi` in with it — `createRoute` is a
 * value, so no bundler can drop it — and that package costs 18.4 ms of every
 * process that loads it (CLI-058). The CLI reads exactly one thing off a route
 * object: `patchDoc.path`. Reading it from here instead is the same single
 * source of truth at none of the cost, and the route below is built from this
 * constant rather than the other way round, so the two cannot disagree.
 *
 * This module deliberately imports nothing.
 */

/** `POST /api/docs/{id}/patch` — the anchored edit (SPEC.md §9.2). */
export const PATCH_DOC_PATH = "/api/docs/{id}/patch";

/**
 * The write routes that present **no key of their own** (SPEC.md §7).
 *
 * There is exactly one. A patch names the text it expects to find, and that
 * naming *is* the staleness check, so §7 exempts it from carrying a key. Every
 * other write in the API is keyed, which is what makes this list — rather than
 * its complement — the one worth publishing: a client deciding how to recover
 * from a `409` needs to know which of the two refusals it is looking at, and
 * that is a property of the route, not of the request.
 */
export const KEYLESS_WRITE_PATHS: readonly string[] = [PATCH_DOC_PATH];
