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

/**
 * The pattern says what a name may contain; this says how much of it there may
 * be (orchestrator ruling, 2026-07-30, on CONTRACT-020's open question 1).
 *
 * The bound exists because `POST /api/skills` turns a name into a **directory**:
 * unbounded, a name long enough to blow the filesystem's own limit would leave
 * the server converting an `ENAMETOOLONG` into something that is not a `400`,
 * for a request that was never going to work. Sixty-four is comfortably above
 * every real skill name — the longest shipped is `orchestrate` at eleven — and
 * comfortably below any path limit, so it refuses only the absurd.
 *
 * It binds the rollback path parameter too, and that is desirable rather than
 * collateral: a name past the bound can name no installed skill, so answering
 * `400` (this input cannot be right) rather than `404` (no such skill) is the
 * more truthful of the two, and the two routes keep one definition of a name.
 */
export const SKILL_NAME_MAX_LENGTH = 64;

export const SkillNameSchema = z
  .string()
  .regex(SKILL_NAME_PATTERN)
  .max(SKILL_NAME_MAX_LENGTH)
  .openapi({
    description:
      "The skill's name, which is its directory name under `.claude/skills/` and the `name` in its " +
      `frontmatter. Lowercase letters, digits and single hyphens, at most ${String(SKILL_NAME_MAX_LENGTH)} ` +
      "characters — it becomes a directory name, and no real skill name comes close to the bound.",
    example: "orchestrate",
  });

/**
 * Skill creation (SPEC.md §7 — skill genesis, "recurring patterns become
 * skills"), the body of `POST /api/skills` and what `corpus skill create` sends.
 *
 * **The skill is named in the body, not in the path**, which is the opposite of
 * every other route on this surface — and for the reason that governs the whole
 * contract: a path names a resource that exists. Creation has no resource yet,
 * so it posts to the collection with the name inside, exactly as `POST /api/docs`
 * does. (`PUT /api/skills/{name}` would say something different and untrue: that
 * the call replaces whatever is there, when a name collision is a `409`.)
 *
 * **The name is the traversal guard.** {@link SkillNameSchema}'s pattern admits
 * no `/`, no `.` and no whitespace, so `../evil`, `a/b`, an absolute path and an
 * encoded traversal segment are all rejected by the schema before a handler
 * runs. The server keeps its own root check — defence in depth, and its root is
 * its own business — but the wire shape is what makes the refusal a `400`
 * naming `body.name` rather than a server-side surprise.
 *
 * **`description` is required, alone among the optional-in fields**, because it
 * is not decoration: Claude Code discovers a skill by its frontmatter `name` and
 * `description`, so a skill created without one is a file that looks installed
 * and can never be invoked. Everything else a skill's frontmatter needs, the
 * server fills in as it does for any document (`id`, `type: skill`, `created`,
 * `updated`, `status`, `anchors`), and everything a caller might want to change
 * later goes through `PUT /api/docs/{id}` — a skill is an ordinary document, so
 * creation is the only verb that has to be skills-specific.
 */
export const SkillCreateRequestSchema = z
  .strictObject({
    name: SkillNameSchema,
    description: z
      .string()
      .min(1)
      .describe(
        "One-line description of when to use the skill, written into the frontmatter `description` " +
          "Claude Code discovers it by. Required: a skill without one is installed but never " +
          "invoked.",
      ),
    title: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Corpus document title, shown on the board (SPEC.md §5). Defaults to the skill's `name`.",
      ),
    body: z
      .string()
      .optional()
      .describe(
        "Markdown body below the frontmatter — the skill's instructions. Omit it to pre-fill from " +
          "the `skill` type's `template` document when the workspace defines one, the same rule " +
          "`POST /api/docs` follows; a workspace with no skill template gets an empty body, which " +
          "the agent then edits like any other document.",
      ),
    tags: z.array(z.string()).optional().describe("Defaults to no tags."),
  })
  .openapi("SkillCreateRequest");

export const SkillRollbackRequestSchema = z
  .strictObject({
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
export type SkillCreateRequest = z.infer<typeof SkillCreateRequestSchema>;
export type SkillRollbackRequest = z.infer<typeof SkillRollbackRequestSchema>;
export type SkillRollbackResult = z.infer<typeof SkillRollbackResultSchema>;
