/**
 * The validation surface (SPEC.md §11): `POST /api/check`, the HTTP form of the
 * one validator every mutation already runs.
 *
 * The validator itself is `core/check.ts` and its server-side wiring — the two
 * injected seams and §7's skill-frontmatter leniency — is `docs/write.ts`'s, so
 * this module is a handler and nothing more. That is deliberate: a second home
 * for either would be a second validator wearing the first one's name.
 */

export { mountCheckRoutes } from "./routes.js";
export type { CheckRoutesDeps } from "./routes.js";
