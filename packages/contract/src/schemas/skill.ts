import { z } from "@hono/zod-openapi";
import { DocIdSchema } from "./id.js";
import { warningsField } from "./warning.js";

/**
 * Skill rollback (SPEC.md §7) — the loop-safety half of "skills and agent
 * definitions are documents".
 *
 * A skill is an ordinary document (`.claude/skills/<name>/SKILL.md`, `type:
 * skill`), editable in the board's editor like any other. That is the point, and
 * it is also the hazard: a bad edit to a core-loop skill (`orchestrate`,
 * `comment`) can break the loop that would otherwise fix it. §7's answer is a
 * targeted git revert **performed by the server** — `corpus skill rollback
 * <name>` — restoring the skill's last-known-good version.
 *
 * The revert lands as a normal auto-commit, which is why the result carries
 * `warnings`: §14's rejected-hook warning has to reach every response that
 * produces a commit, or the guarantee is selectively true.
 */

/**
 * Claude Code's own constraint on a skill's name, which is also its directory
 * name under `.claude/skills/`: lowercase letters, digits and single hyphens.
 * Validated in the path so a rollback can never be aimed at a traversal segment
 * or at a directory Claude Code would not discover in the first place.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SkillNameSchema = z
  .string()
  .regex(SKILL_NAME_PATTERN)
  .openapi({
    description:
      "The skill's name, which is its directory name under `.claude/skills/` and the `name` in its " +
      "frontmatter. Lowercase letters, digits and single hyphens.",
    example: "orchestrate",
  });

export const SkillRollbackRequestSchema = z
  .object({
    // Optional-in: omitted means last-known-good, which is the server's job to
    // determine. `null` says the same thing explicitly, so a client holding a
    // nullable ref never has to strip the key before sending.
    to: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        "Git ref to restore the skill from — a commit sha, tag or any revision git resolves. " +
          "Omit it (or send null) to restore the last-known-good version, which is the newest " +
          "committed revision of the file that validates (SPEC.md §7).",
      ),
  })
  .openapi("SkillRollbackRequest");

export const SkillRollbackResultSchema = z
  .object({
    name: SkillNameSchema,
    docId: DocIdSchema.describe(
      "Id of the restored skill document. Unchanged by the rollback — ids are immutable (§5), so " +
        "this is the id the board, the projection and every thread anchored to the skill already " +
        "use.",
    ),
    // Nullable because §14 forbids the only alternative outcomes. When the
    // workspace's git hooks reject the auto-commit — or the workspace has no git
    // at all — the server neither rolls the restoration back nor fails the
    // request: the write stands and the reason becomes a warning. There is then
    // no sha for this rollback. Reporting the pre-existing HEAD instead would
    // satisfy the regex by putting a commit that is not this restoration into a
    // field whose whole purpose is the audit trail, so `null` is the only honest
    // value. Inline (never a registered component), so `.nullable()` cannot
    // rewrite a shared schema.
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/)
      .nullable()
      .describe(
        "Sha of the commit the server made to restore the file — the new HEAD, not the ref the " +
          "content came from. `git show <commit>` is the audit trail entry for this rollback. " +
          "`null` means the file was restored but not committed: the auto-commit failed or was " +
          "skipped, the file write stands regardless (SPEC.md §14), and the reason — the " +
          "workspace's own hook output for `commit_failed`, or `commit_skipped` for a workspace " +
          "with no git — is in `warnings`. A rollback that reports `null` has still changed the " +
          "file on disk.",
      ),
    path: z
      .string()
      .describe(
        "Workspace-relative path of the restored file, e.g. `.claude/skills/orchestrate/SKILL.md`.",
      ),
    warnings: warningsField,
  })
  .openapi("SkillRollbackResult");

export type SkillName = z.infer<typeof SkillNameSchema>;
export type SkillRollbackRequest = z.infer<typeof SkillRollbackRequestSchema>;
export type SkillRollbackResult = z.infer<typeof SkillRollbackResultSchema>;
