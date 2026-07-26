// The acting party carried by every mutating request. Kept zod-free and outside
// `schemas/` so the generated client can import the header name and the literal
// union without pulling the whole validation layer into a browser bundle;
// `schemas/actor.ts` derives its Zod schema from these values, so there is still
// exactly one source of truth.

/**
 * Header carrying the acting party. Lowercase because Hono normalises header
 * names, and the zod-openapi header validator matches on the normalised key.
 */
export const ACTOR_HEADER = "x-corpus-author";

export const ACTORS = ["user", "agent"] as const;

export type Actor = (typeof ACTORS)[number];

/** Assumed when a request omits {@link ACTOR_HEADER}, so browser clients need no ceremony. */
export const DEFAULT_ACTOR: Actor = "user";
