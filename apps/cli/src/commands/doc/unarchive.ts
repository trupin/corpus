import type { DocStatus } from "@corpus/contract";
import { warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc unarchive` — the other half of `corpus doc archive`, and the
 * recovery path the agent is already told to use (SPEC.md §7).
 *
 * The route has shipped since the archive work landed; the CLI-only agent
 * simply could not reach it, so the server's own `409` on an archived skill
 * name — "unarchive it to bring it back" — named an operation with no command
 * behind it (sprint-016 evaluator, MAJOR). This verb is that command, and it is
 * deliberately nothing more than the round trip: unarchiving a skill moves its
 * folder back out of `.claude/skills-archived/`, which frees the name, and every
 * bit of that lives server-side.
 *
 * The status is read first for the same reason `archive` reads it: the server
 * treats unarchiving an already-open document as a no-op that commits nothing,
 * and its response cannot say which of the two happened.
 */

export async function runDocUnarchive(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const before = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );
  const wasArchived = before.frontmatter.status === "archived";

  const response = await context.client.request((api) =>
    api.POST("/api/docs/{id}/unarchive", { params: { path: { id } } }),
  );

  context.out.emit(response);
  const suffix = warningSuffix(response.warnings);
  context.out.line(
    `${describeOutcome(id, wasArchived, before.frontmatter.status, response.doc.frontmatter.status)}${suffix}`,
  );
}

/**
 * Unarchiving is `status: open`, not "the status before archiving" — the server
 * keeps no memory of what it was. So a `resolved` document really does come back
 * `open`, and reporting that as an untouched no-op would be a small lie of
 * exactly the kind this issue exists to remove.
 */
export function describeOutcome(
  id: string,
  wasArchived: boolean,
  before: DocStatus,
  after: DocStatus,
): string {
  if (wasArchived) return `unarchived ${id}`;
  return after === before
    ? `${id} is not archived`
    : `${id} was not archived — status is now ${after}`;
}

export const unarchiveCommand: WorkspaceCommandSpec = {
  name: "unarchive",
  summary: "Bring an archived document back.",
  description:
    "The reverse of `corpus doc archive`, and the whole of it: `status` goes back to `open` and a " +
    "`type: skill` document's folder moves back from `.claude/skills-archived/` to " +
    "`.claude/skills/`, which re-enables the skill **and frees its name** — a `409` from " +
    "`corpus skill create` saying the name belongs to an archived skill is telling you to run " +
    "this verb. Unarchiving a document that is not archived is a no-op reporting exactly that and " +
    "exits 0, mirroring `archive`'s treatment of an already-archived document, so a retried loop " +
    "is harmless; note that unarchiving is `status: open` rather than a memory of the previous " +
    "status, so a `resolved` document comes back `open` and the line says so. If a folder is " +
    "already sitting at the destination path the server refuses rather than merging the two, and " +
    "its message names the directory to move or remove first.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus doc unarchive doc_a1b2c3",
      description: "Bring an archived note back into the default result set.",
    },
    {
      command: "corpus doc unarchive doc_a1b2c3 --from agent --json",
      description:
        'Re-enable an archived skill and free its name, attributed to the agent. One JSON value — `{"doc":{…},"warnings":[]}`.',
    },
  ],
  handler: (context) => runDocUnarchive(context),
};
