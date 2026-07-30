import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus skill rollback` — SPEC.md §7's loop-safety escape hatch.
 *
 * Skills are ordinary documents, editable in the board like any other. That is
 * the point, and it is also the hazard: a bad edit to `orchestrate` or `comment`
 * can break the loop that would otherwise fix it. The way back is a targeted
 * revert performed **by the server** — the CLI names the skill and renders the
 * answer; it does not touch git, and it does not touch the file.
 *
 * The verb reports the restored path and the commit that restored it. `commit`
 * may honestly be `null`: §14 is explicit that a rejected workspace git hook
 * never rolls back a file write, so the restoration stands uncommitted and the
 * reason arrives in `warnings`. Printing a plausible sha there would put a lie
 * in an audit field, so the human line says "uncommitted" instead.
 */

export async function runSkillRollback(context: WorkspaceCommandContext): Promise<void> {
  const name = context.args.get("name");
  const to = context.flags.string("to");

  const result = await context.client.request((api) =>
    api.POST("/api/skills/{name}/rollback", {
      params: { path: { name } },
      // The body is optional in full: a bare POST restores the last-known-good
      // version, which is what an operator with a broken loop types.
      ...(to === undefined ? {} : { body: { to } }),
    }),
  );

  context.out.emit(result);
  context.out.line(
    result.commit === null
      ? `restored ${result.path} — uncommitted, the file write stands (${result.docId})`
      : `restored ${result.path} in commit ${result.commit} (${result.docId})`,
  );
  for (const warning of result.warnings) {
    context.out.line(`warning ${warning.code}: ${warning.detail}`);
  }
}

export const rollbackCommand: WorkspaceCommandSpec = {
  name: "rollback",
  summary: "Restore a skill's last-known-good version through the server.",
  description:
    "Calls `POST /api/skills/{name}/rollback`, which restores `.claude/skills/<name>/SKILL.md` " +
    "from git and commits the restoration as a normal auto-commit attributed to `--from` — so " +
    "`git log` stays the whole audit trail and the board re-projects like it does for any other " +
    "write. Prints the restored path and the **new** commit, not the revision the content came " +
    "from. `--to` steps further back to any revision git resolves.\n\n" +
    "A `commit` of `null` is reported as _uncommitted_ rather than dressed up: the workspace's " +
    "own git hooks rejected the auto-commit (or there is no git), the file was restored anyway " +
    "(SPEC.md §14), and the reason is printed as a warning. A skill nobody installed — including " +
    "one that was archived, which moves it out of `.claude/skills/` — is the server's `404`, " +
    "which is exit 5.",
  args: [
    {
      name: "name",
      required: true,
      description:
        "The skill's directory name under `.claude/skills/`: lowercase letters, digits and single hyphens.",
    },
  ],
  flags: [
    {
      name: "to",
      type: "string",
      valueName: "ref",
      description:
        "Restore from this revision — a commit sha, a tag, anything git resolves. Omitted, the " +
        "last-known-good version is used.",
    },
  ],
  examples: [
    {
      command: "corpus skill rollback orchestrate --from agent",
      description: "Undo a bad edit to the core loop skill and record the agent as its author.",
    },
    {
      command: "corpus skill rollback comment --to 9f3c1ab",
      description: "Step a skill back to a specific commit rather than the last-known-good one.",
    },
    {
      command: "corpus skill rollback orchestrate --json",
      description:
        'One JSON value: `{"name":"orchestrate","docId":"doc_skill1a2b3c4d","commit":"9f3c1ab",' +
        '"path":".claude/skills/orchestrate/SKILL.md","warnings":[]}`.',
    },
  ],
  handler: (context) => runSkillRollback(context),
};
