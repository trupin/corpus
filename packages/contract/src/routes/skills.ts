import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { DocMutationResponseSchema } from "../schemas/doc.js";
import { SkillCreateRequestSchema } from "../schemas/skill.js";
import {
  CONFLICT_RESPONSE,
  jsonContent,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * The skills surface is **one route wide**, and that is the whole design.
 *
 * A skill is an ordinary document (SPEC.md §7), so it is read, edited, archived
 * and reverted through the document routes. Creation is the only operation with
 * no document equivalent, because a skill is the one document that lives outside
 * `data/docs/`.
 *
 * **There is no rollback route.** §7's loop safety is a write whose content came
 * from history — the caller reads the history and `PUT /api/docs/{id}`s the
 * content it wants back, presenting the key of the version it read. A dedicated
 * revert route would have to reimplement anchor reconciliation (§6), validation
 * (§14), attributed commit (§4) and the key (§7), and would restore a whole file
 * rather than revert a path, silently discarding anything not yet committed.
 * _(Rider signed 2026-08-12 — replaces `POST /api/skills/{name}/rollback`.)_
 */

/**
 * Skill creation (SPEC.md §7) — `corpus skill create <name>`, the verb that
 * turns §7's genesis clause from *propose* into *create*.
 *
 * **Why the skills surface owns a create route at all.** Every other document
 * is created through `POST /api/docs`, and that route files under `data/docs/`
 * by construction — folders are resolved against the documents root and nothing
 * else. A skill lives at `.claude/skills/{name}/SKILL.md`, a different root with
 * a different shape (a directory per skill, one fixed filename), so the choice
 * was between a create route that accepts arbitrary roots and one that knows
 * about skills. This is the second: **there is no wire form here for writing
 * outside `.claude/skills/`**, which is the property the traversal guard rests
 * on. A third root, if one is ever wanted, is a third enumerated route.
 *
 * Everything downstream of the write is the ordinary pipeline, because a skill
 * is an ordinary document (SPEC.md §7): validation, atomic write, git
 * auto-commit authored by `x-corpus-author`, synchronous re-projection and SSE
 * invalidation. The skill is therefore on the board and in
 * `GET /api/docs?type=skill` without a restart, and it is edited — and reverted
 * — afterwards through `PUT /api/docs/{id}` like anything else.
 */
export const createSkill = createRoute({
  method: "post",
  path: "/api/skills",
  tags: ["skills"],
  summary: "Create a skill",
  description:
    "Creates `.claude/skills/{name}/SKILL.md` through the server's ordinary mutation pipeline — " +
    "the write path SPEC.md §7's skill genesis needs, since the agent reaches the workspace only " +
    "through the CLI and the server is the sole writer (SPEC.md §9.1).\n\n" +
    "**The created file carries both frontmatter vocabularies**, which is what makes a skill " +
    "simultaneously a Claude Code skill and a Corpus document: `name` (equal to the directory " +
    "name) and `description` for Claude Code's discovery, plus the core document keys the server " +
    "assigns — `id`, `type: skill`, `title`, `created`, `updated`, `tags`, `status`, `anchors`.\n\n" +
    "**The skill is named in the body rather than in the path** because the path names a resource " +
    "that does not exist yet; this is `POST /api/docs`'s convention. The name doubles as the " +
    "traversal guard: it is validated against a pattern that admits no `/`, `.` or whitespace, so " +
    "a traversal attempt is a `400` naming `body.name` and never reaches the filesystem.\n\n" +
    "**The creation lands as a normal auto-commit** (SPEC.md §9.2) and is projected and " +
    "broadcast like any other write, so the new skill appears on the board and in " +
    "`GET /api/docs?type=skill` without a restart. If the workspace's git hooks reject the " +
    "commit, the file stands anyway and the rejection comes back in `warnings` (SPEC.md §14).\n\n" +
    "`409` means the name is taken — a skill of that name is already installed. Whether a name " +
    "held only by an *archived* skill (`.claude/skills-archived/{name}/`, where " +
    "`corpus doc archive` moves one) is likewise taken is answered by the server, and both " +
    "answers are already describable here: refusing it is this same `409`, allowing it is a " +
    "plain `201`.\n\n" +
    "It presents no key (SPEC.md §7): this call's document does not exist until the call " +
    "succeeds, so there is no version anyone could have read. Editing the skill afterwards goes " +
    "through `PUT /api/docs/{id}`, which does demand a key for a body write.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The skill to create. `name` and `description` are mandatory, so the body is.",
      content: { "application/json": { schema: SkillCreateRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(
      DocMutationResponseSchema,
      "The created skill as an ordinary document — its frontmatter, body and workspace-relative " +
        "path — plus any §14 warnings. The same shape `POST /api/docs` returns, because what was " +
        "created is the same kind of thing.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});
