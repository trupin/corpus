import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { runArchiveToggle } from "./archive-toggle.js";

/**
 * `corpus doc archive` — the agent's alternative to deleting anything (SPEC.md
 * §7). Archiving is a reversible flip of `status`: the file stays, git keeps
 * every version, and the document stays indexed — it simply drops out of the
 * default result set.
 *
 * The document is read first for the same reason `move` reads the path: the
 * server treats a second archive as a no-op that commits nothing, and its
 * response cannot say which of the two happened. `runArchiveToggle` owns that
 * shape, shared with `unarchive`; all this verb supplies is the direction, the
 * route and the two lines.
 */

export async function runDocArchive(context: WorkspaceCommandContext): Promise<void> {
  await runArchiveToggle(context, {
    wantArchived: true,
    post: (ctx, id) =>
      ctx.client.request((api) => api.POST("/api/docs/{id}/archive", { params: { path: { id } } })),
    moved: (id) => `archived ${id}`,
    settled: (id) => `${id} is already archived`,
  });
}

export const archiveCommand: WorkspaceCommandSpec = {
  name: "archive",
  summary: "Archive a document (reversible; never a deletion).",
  description:
    "Flips `status` to `archived`. Nothing leaves git and nothing leaves the index: the document " +
    "drops out of the default `GET /api/docs` result set and comes back with `status=archived` " +
    "(SPEC.md §7). This is the verb the agent uses where a person would reach for delete — the " +
    "agent archives, never deletes. Archiving a document that is already archived **sends " +
    "nothing at all**: it reports “already archived” and exits 0, so a retried loop is harmless. " +
    "The one exception is a `type: skill` document whose folder has not followed its status — " +
    "there the request goes out and moves the folder, because that is a real repair. " +
    "Archiving a `type: skill` document also moves its folder to `.claude/skills-archived/`, " +
    "which disables the skill without unindexing it. Archiving **names its own delta**, so it " +
    "needs no key (SPEC.md §7) and is never refused for a document someone else is writing.",
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
