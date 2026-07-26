import { z } from "@hono/zod-openapi";
import { ACTOR_HEADER, ACTORS, DEFAULT_ACTOR } from "../actor.js";

// Unnamed on purpose — see the note in `id.ts`; `ActorHeaderSchema` derives a
// defaulted variant, which would otherwise clobber a registered component.

export const ActorSchema = z.enum(ACTORS).openapi({
  description:
    "The acting party for a request. Becomes the git author of the auto-commit the server makes " +
    "for the mutation (SPEC.md §4, §7).",
  example: "user",
});

/**
 * Header parameters shared by every mutating route. Optional with a documented
 * default rather than required: the UI is served same-origin and should not have
 * to name itself on every write, while the CLI always sends `agent` explicitly.
 */
export const ActorHeaderSchema = z.object({
  [ACTOR_HEADER]: z
    .enum(ACTORS)
    .default(DEFAULT_ACTOR)
    .openapi({
      param: { name: ACTOR_HEADER, in: "header", required: false },
      description: `Acting party, and therefore the git author of the auto-commit. Defaults to "${DEFAULT_ACTOR}" when absent.`,
    }),
});

export type ActorHeader = z.infer<typeof ActorHeaderSchema>;
