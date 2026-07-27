import { warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc archive` — the agent's alternative to deleting anything (SPEC.md
 * §7). Archiving is a reversible flip of `status`: the file stays, git keeps
 * every version, and the document stays indexed — it simply drops out of the
 * default result set.
 *
 * The status is read first for the same reason `move` reads the path: the server
 * treats a second archive as a no-op that commits nothing, and its response
 * cannot say which of the two happened.
 */

export async function runDocArchive(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const before = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );
  const wasArchived = before.frontmatter.status === "archived";

  const response = await context.client.request((api) =>
    api.POST("/api/docs/{id}/archive", { params: { path: { id } } }),
  );

  context.out.emit(response);
  const suffix = warningSuffix(response.warnings);
  context.out.line(wasArchived ? `${id} is already archived${suffix}` : `archived ${id}${suffix}`);
}

export const archiveCommand: WorkspaceCommandSpec = {
  name: "archive",
  summary: "Archive a document (reversible; never a deletion).",
  description:
    "Flips `status` to `archived`. Nothing leaves git and nothing leaves the index: the document " +
    "drops out of the default `GET /api/docs` result set and comes back with `status=archived` " +
    "(SPEC.md §7). This is the verb the agent uses where a person would reach for delete — the " +
    "agent archives, never deletes. Archiving an already-archived document reports “already " +
    "archived” and exits 0 without writing or committing, so a retried loop is harmless. " +
    "Archiving a `type: skill` document also moves its folder to `.claude/skills-archived/`, " +
    "which disables the skill without unindexing it. A `423` from the other party's edit lock is " +
    "a server error (exit 5).",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus doc archive doc_a1b2c3",
      description: "Retire a note that is no longer current, keeping every version in git.",
    },
    {
      command: "corpus doc archive doc_a1b2c3 --from agent --json",
      description:
        'One JSON value — `{"doc":{…},"warnings":[]}` — with the archiving attributed to the agent.',
    },
  ],
  handler: (context) => runDocArchive(context),
};
