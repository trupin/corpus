import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  SkillNameSchema,
  SkillRollbackRequestSchema,
  SkillRollbackResultSchema,
} from "../schemas/skill.js";
import {
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
 * `/api/locks/{docId}`, `/api/threads/{id}/…`), the `404` gets its natural home,
 * and a rollback reads as what it is — an action on a named skill rather than a
 * free-floating verb that happens to take a name.
 *
 * The revert itself is git's, performed by the server because the server is the
 * sole writer (SPEC.md §9.1): a CLI that ran `git checkout` on a skill file
 * would bypass validation, the projection and the watcher all at once.
 */

const SkillNameParamSchema = z.object({
  name: SkillNameSchema.openapi({ param: { name: "name", in: "path", required: true } }),
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
    "unarchive it first.",
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
