import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { DocMutationResponseSchema } from "../schemas/doc.js";
import {
  SkillCreateRequestSchema,
  SkillNameSchema,
  SkillRollbackRequestSchema,
  SkillRollbackResultSchema,
} from "../schemas/skill.js";
import {
  CONFLICT_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * Skill rollback (SPEC.md §7) — `corpus skill rollback <name>`.
 *
 * The skill is identified in the **path**, not in the body: every other resource
 * route in this contract addresses its resource that way (`/api/docs/{id}`,
 * `/api/threads/{id}/…`), the `404` gets its natural home,
 * and a rollback reads as what it is — an action on a named skill rather than a
 * free-floating verb that happens to take a name.
 *
 * The revert itself is git's, performed by the server because the server is the
 * sole writer (SPEC.md §9.1): a CLI that ran `git checkout` on a skill file
 * would bypass validation, the projection and the watcher all at once.
 *
 * **It presents no key** (SPEC.md §7). A rollback rewrites
 * `.claude/skills/{name}/SKILL.md` wholesale, so the question is real, and the
 * answer is that it names its own delta as precisely as any other verb: it
 * restores *a named revision* — the caller states which version it wants, not a
 * block of text it composed against a version it read. There is nothing here a
 * key could be evidence of. Ordinary editing of the skill afterwards goes
 * through `PUT /api/docs/{id}`, which does demand one for a body write.
 */

const SkillNameParamSchema = z.object({
  name: SkillNameSchema.openapi({ param: { name: "name", in: "path", required: true } }),
});

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
 * invalidation. The skill is therefore on the board, in `GET /api/docs?type=skill`
 * and available to `corpus skill rollback` without a restart, and it is edited
 * afterwards through `PUT /api/docs/{id}` like anything else.
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
    "that does not exist yet; this is `POST /api/docs`'s convention, not a departure from the " +
    "rollback route's. The name doubles as the traversal guard: it is validated against the same " +
    "pattern the rollback path parameter uses, which admits no `/`, `.` or whitespace, so a " +
    "traversal attempt is a `400` naming `body.name` and never reaches the filesystem.\n\n" +
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

export const rollbackSkill = createRoute({
  method: "post",
  path: "/api/skills/{name}/rollback",
  tags: ["skills"],
  summary: "Restore a skill's last-known-good version",
  description:
    "Restores `.claude/skills/{name}/SKILL.md` from git and commits the restoration — the " +
    "targeted revert SPEC.md §7 names as the loop-safety escape hatch. Skills are ordinary " +
    "documents and are edited like ordinary documents, so a bad edit to a core-loop skill " +
    "(`orchestrate`, `comment`) can break the very loop that would otherwise fix it; this is the " +
    "operator's way back, and the orchestrate skill documents it.\n\n" +
    "**The body is optional in full.** A bare `POST` restores the last-known-good version — the " +
    "newest committed revision of the file that validates. `to` overrides that with any revision " +
    "git resolves, for stepping further back.\n\n" +
    "**The restoration lands as a normal auto-commit**, authored by `x-corpus-author` like every " +
    "other mutation (§9.2), so `git log` remains the complete audit trail and the projection and " +
    "SSE stream follow as they do for any write. `commit` in the response is that new commit, not " +
    "the revision the content came from; `path` is the file it rewrote; `docId` is the skill " +
    "document's id, which a rollback never changes (ids are immutable, §5). If the workspace's " +
    "git hooks reject the commit, the file is restored anyway, `commit` is `null` and the " +
    "rejection comes back in `warnings` (§14).\n\n" +
    "`404` means no skill of that name is installed — there is no `.claude/skills/{name}/` " +
    "directory. A skill that was archived (`corpus doc archive` moves it to " +
    "`.claude/skills-archived/`) is likewise not installed, so rolling it back is a `404`: " +
    "unarchive it first.\n\n" +
    "A skill is an ordinary document, but this write names a revision rather than replacing a " +
    "block, so it presents no key (SPEC.md §7 — see the module docblock).",
  request: {
    params: SkillNameParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "Optional revision override; omit the body entirely to restore the last-known-good version.",
      content: { "application/json": { schema: SkillRollbackRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      SkillRollbackResultSchema,
      "The skill is restored; `commit` is the auto-commit that restored it, or `null` when that " +
        "commit failed or was skipped and the restoration stands uncommitted.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
