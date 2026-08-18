import {
  bodyFlags,
  requireFlag,
  resolveBody,
  splitTags,
  warningSuffix,
  type InputDependencies,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus skill create` — SPEC.md §7's skill genesis, the verb that turns
 * "recurring patterns become skills" from a proposal the agent writes into a
 * skill the agent installs.
 *
 * It is a thin call onto `POST /api/skills`, and the route being skills-specific
 * is the point rather than an inconvenience: there is no wire form here for
 * writing outside `.claude/skills/`, so the CLI has nothing to guard and nothing
 * to sanitize. The name is the traversal guard, validated server-side; a name
 * with a slash, a `..`, an uppercase letter or 65 characters comes back as the server's
 * `400` naming `body.name`, and a name already installed as its `409` (both exit
 * 5). Pre-validating any of that here would only mean two definitions of a skill
 * name, one of which is wrong the day the contract's pattern changes.
 *
 * `--description` is required because Claude Code discovers a skill by its
 * frontmatter `name` and `description`: a skill created without one is a file
 * that looks installed and can never be invoked.
 */

export async function runSkillCreate(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const name = context.args.get("name");
  const description = requireFlag(context, "description", "text");
  const title = context.flags.string("title");
  const body = await resolveBody(context, dependencies);
  const tags = splitTags(context.flags.string("tags"));

  const response = await context.client.request((api) =>
    api.POST("/api/skills", {
      body: {
        name,
        description,
        // Omitted rather than sent as undefined, exactly as `doc create` does:
        // the contract distinguishes "no body" (pre-fill from the `skill`
        // type's template) from an explicitly empty one.
        ...(title === undefined ? {} : { title }),
        ...(body === undefined ? {} : { body }),
        ...(tags === undefined ? {} : { tags }),
      },
    }),
  );

  context.out.emit(response);
  context.out.line(
    `created ${response.doc.frontmatter.id} — ${response.doc.path}${warningSuffix(response.warnings)}`,
  );
}

export const createCommand: WorkspaceCommandSpec = {
  name: "create",
  summary: "Create a skill through the server.",
  description:
    "Calls `POST /api/skills`, which writes `.claude/skills/<name>/SKILL.md` through the ordinary " +
    "mutation pipeline — validation, atomic write, git auto-commit attributed to `--from`, " +
    "synchronous re-projection and SSE invalidation. The skill is therefore live immediately: on " +
    "the board and in `corpus doc list --type skill`, with no server restart. The CLI writes " +
    "nothing itself; the server is the sole writer.\n\n" +
    "The created file carries **both** frontmatter vocabularies, which is what makes a skill " +
    "simultaneously a Claude Code skill and a Corpus document: `name` (equal to the directory " +
    "name) and `description` for discovery, then the document keys the server assigns — `id`, " +
    "`type: skill`, `title`, `created`, `updated`, `tags`, `status`, `anchors`. `--description` " +
    "is required rather than optional: a skill without one is installed but never invoked.\n\n" +
    "The name is the traversal guard and it is checked by the server, not here — lowercase " +
    "letters, digits and single hyphens, at most 64 characters. A name with a slash, a `..` " +
    "segment or an uppercase letter is the server's `400`; a name already installed, or held by " +
    "an archived skill, is its `409`. Both are exit 5, and neither writes anything. Everything " +
    "after creation is ordinary document work: edit with `corpus doc edit`, disable with " +
    "`corpus doc archive`, and undo a bad edit by writing back the content you want — read the " +
    "history with `corpus doc diff <id>`, then `corpus doc edit <id> --key <key>`.",
  args: [
    {
      name: "name",
      required: true,
      description:
        "The skill's directory name under `.claude/skills/`, and its frontmatter `name`: lowercase " +
        "letters, digits and single hyphens.",
    },
  ],
  flags: [
    {
      name: "description",
      type: "string",
      valueName: "text",
      description:
        "One line saying when to use the skill — what Claude Code discovers it by. Required.",
    },
    {
      name: "title",
      type: "string",
      valueName: "text",
      description: "The document title shown on the board. Defaults to the skill's name.",
    },
    {
      name: "tags",
      type: "string",
      valueName: "a,b",
      description: "Comma-separated tags. Blank entries are dropped; defaults to no tags.",
    },
    ...bodyFlags("The skill's instructions"),
  ],
  examples: [
    {
      command:
        "corpus skill create weekly-review --description \"Run the weekly review over the corpus.\" --from agent <<'CORPUS_EOF'\n# Weekly review\n\nSurvey `corpus doc list --needs me` and file what has drifted.\nCORPUS_EOF",
      description:
        "The agent's genesis form (SPEC.md §7): instructions from a heredoc, committed with `agent` as the git author.",
    },
    {
      command: 'corpus skill create triage --description "Triage the inbox."',
      description:
        "No body: the server pre-fills from the workspace's `skill` template when it has one, and leaves the body empty otherwise.",
    },
    {
      command: 'corpus skill create triage --description "Triage the inbox." --json',
      description:
        'One JSON value — `{"doc":{"frontmatter":{"id":"doc_wy3a54lf","type":"skill",…},"body":"…",' +
        '"path":".claude/skills/triage/SKILL.md","anchors":[]},"warnings":[]}` — the same envelope ' +
        "`corpus doc create` returns, because what was created is the same kind of thing.",
    },
  ],
  handler: (context) => runSkillCreate(context),
};
