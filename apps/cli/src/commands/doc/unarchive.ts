import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { runArchiveToggle } from "./archive-toggle.js";

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
 * The document is read first, and **a document that is already unarchived is
 * left completely alone** — no request. That is not politeness: the route sets
 * `status: open` unconditionally, so sending it at a `resolved` document
 * silently reopened it while the output line called the run a no-op (wave-3
 * audit, FIX 11). What counts as "already unarchived" is decided by
 * `isSettled`, which looks at the folder as well as the status so the one
 * half-state worth repairing still is.
 */

export async function runDocUnarchive(context: WorkspaceCommandContext): Promise<void> {
  await runArchiveToggle(context, {
    wantArchived: false,
    post: (ctx, id) =>
      ctx.client.request((api) =>
        api.POST("/api/docs/{id}/unarchive", { params: { path: { id } } }),
      ),
    moved: (id) => `unarchived ${id}`,
    settled: (id) => `${id} is not archived`,
  });
}

export const unarchiveCommand: WorkspaceCommandSpec = {
  name: "unarchive",
  summary: "Bring an archived document back.",
  description:
    "The reverse of `corpus doc archive`, and the whole of it: `status` goes back to `resolved` and a " +
    "`type: skill` document's folder moves back from `.claude/skills-archived/` to " +
    "`.claude/skills/`, which re-enables the skill **and frees its name** — a `409` from " +
    "`corpus skill create` saying the name belongs to an archived skill is telling you to run " +
    "this verb. Note that the status it restores is `resolved` — the state archiving already implied " +
    "(SPEC.md §5) — not a memory of what the status was before archiving, which the server does " +
    "not keep: a document archived while `open` also comes back `resolved`. A document that is " +
    "**not** archived is left exactly as it is: the verb " +
    "reports that and exits 0 without sending anything, mirroring `archive`'s treatment of an " +
    "already-archived document, so a retried loop is harmless and a `resolved` document is never " +
    "quietly reopened by one. The one exception is a `type: skill` document whose folder is " +
    "still in `.claude/skills-archived/` although its status says otherwise: that half-state is " +
    "real and this verb repairs it. If a folder is already sitting at the destination path the " +
    "server refuses rather than merging the two, and its message names the directory to move or " +
    "remove first.",
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
