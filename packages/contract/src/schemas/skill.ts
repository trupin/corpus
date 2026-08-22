import { z } from "@hono/zod-openapi";

/**
 * Skills as documents (SPEC.md §7) — the wire shapes of the one skill operation
 * that has no document equivalent.
 *
 * A skill is an ordinary document (`.claude/skills/<name>/SKILL.md`, `type:
 * skill`), so reading, editing, archiving and **reverting** one all go through
 * the document routes. Only **genesis** is skills-specific, because a skill is
 * the one document that lives outside `data/docs/` and `POST /api/docs` files
 * everything under it — hence `POST /api/skills` and nothing else here.
 *
 * There is deliberately no rollback shape. §7's loop safety is a write whose
 * content came from history: the caller reads the history, works out the content
 * it wants back, and sends it to `PUT /api/docs/{id}` with the key of the
 * version it read — reconciling anchors (§6), validating (§11), committing under
 * the acting party (§4) and refusing a stale key (§7) exactly as every other
 * write does. _(Rider signed 2026-08-12 — replaced `POST /api/skills/{name}/rollback`,
 * which restored a whole file from a revision and so silently discarded anything
 * not yet committed.)_
 */

/**
 * Claude Code's own constraint on a skill's name, which is also its directory
 * name under `.claude/skills/`: lowercase letters, digits and single hyphens.
 * Validated on the wire so a creation can never be aimed at a traversal segment
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

export type SkillName = z.infer<typeof SkillNameSchema>;
export type SkillCreateRequest = z.infer<typeof SkillCreateRequestSchema>;
