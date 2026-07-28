import { createInterface } from "node:readline/promises";
import { UsageError } from "../../errors.js";
import { plural, stdinIsTTY, stdinStream, warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc delete` — the one verb in the stewardship surface that is
 * **user-only** (SPEC.md §7, §9.2).
 *
 * The refusal is client-side and happens before anything is sent: an agent whose
 * request reached the server would already have been a design failure, and a
 * guard that relies on the server's `403` cannot explain *why* in the agent's
 * own vocabulary. The server's `403` stays as the backstop — this is defence in
 * depth, not a replacement for it.
 *
 * Confirmation is equally deliberate. A piped stdin is **never** read as a
 * confirmation: the agent's normal invocation is non-TTY, and several verbs in
 * this surface read a document body from stdin, so a heredoc meant as prose
 * could otherwise authorise a deletion. Without a terminal, `--yes` is the only
 * way through, and its absence is a usage error that returns immediately rather
 * than a prompt nobody can answer.
 */

export const AGENT_REFUSAL = "deletion is user-only — the agent archives, never deletes";

export interface DeleteDependencies {
  /** Defaults to whether the process's stdin is a terminal. */
  readonly stdinIsTTY?: boolean;
  /** Defaults to a readline prompt on the terminal; injectable so tests need no TTY. */
  readonly confirm?: (question: string) => Promise<boolean>;
}

export async function runDocDelete(
  context: WorkspaceCommandContext,
  dependencies: DeleteDependencies = {},
): Promise<void> {
  const id = context.args.get("id");

  if (context.actor !== "user") {
    throw new UsageError(AGENT_REFUSAL, {
      hint: `Archive it instead: \`corpus doc archive ${id}\`. Nothing was sent to the server.`,
    });
  }

  if (!context.flags.boolean("yes")) {
    await confirmOrRefuse(context, id, dependencies);
  }

  const response = await context.client.request((api) =>
    api.DELETE("/api/docs/{id}", { params: { path: { id } } }),
  );

  context.out.emit(response);
  const orphaned = response.orphanedThreadIds;
  const detail =
    orphaned.length === 0
      ? ""
      : ` — orphaned ${plural(orphaned.length, "thread")} (${orphaned.join(", ")})`;
  context.out.line(`deleted ${response.deletedId}${detail}${warningSuffix(response.warnings)}`);
}

async function confirmOrRefuse(
  context: WorkspaceCommandContext,
  id: string,
  dependencies: DeleteDependencies,
): Promise<void> {
  const isTTY = dependencies.stdinIsTTY ?? stdinIsTTY();
  if (!isTTY) {
    throw new UsageError(`refusing to delete ${id} without --yes.`, {
      hint: "Deleting is irreversible in the working tree (git keeps the history). Re-run with --yes, or archive instead.",
    });
  }

  const ask = dependencies.confirm ?? promptOnTerminal;
  const confirmed = await ask(`Delete ${id}? Its threads become orphaned records. [y/N] `);
  if (!confirmed) throw new UsageError(`cancelled: ${id} was not deleted.`);
}

/**
 * The prompt goes to **stderr** so that stdout carries only the command's
 * result, and only an explicit yes counts — a bare Return, an empty line or
 * anything else leaves the document where it is.
 */
export async function promptOnTerminal(
  question: string,
  input: NodeJS.ReadableStream = stdinStream(),
  output: NodeJS.WritableStream = process.stderr,
): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export const deleteCommand: WorkspaceCommandSpec = {
  name: "delete",
  summary: "Delete a document (user-only, irreversible in the working tree).",
  description:
    "**The agent may not run this.** `--from agent` (or `CORPUS_FROM=agent`) is refused here, " +
    "before any request is sent, with exit 2: the agent archives, never deletes (SPEC.md §7). " +
    "The server rejects it with a `403` as well; this guard exists so the agent gets the reason " +
    "rather than a status code. Deletion cascades to the document's threads, which survive as " +
    "**orphaned records** — still readable, still naming this document as `parent`, with anchors " +
    "that no longer resolve — and the printed line names every one of them. Nothing is removed " +
    "from git history. Confirmation is required: with a terminal you are asked, and without one " +
    "`--yes` is mandatory, because a piped body must never be mistaken for a yes.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [
    {
      name: "yes",
      type: "boolean",
      description:
        "Skip the confirmation prompt. Required whenever stdin is not a terminal — a script or " +
        "a hook has no way to answer one.",
    },
  ],
  examples: [
    {
      command: "corpus doc delete doc_a1b2c3 --yes",
      description: "Delete a document from a script, as the user; git retains every version of it.",
    },
    {
      command: "corpus doc delete doc_a1b2c3 --yes --json",
      description:
        'One JSON value — `{"deletedId":"doc_a1b2c3","orphanedThreadIds":["th_x9y8"],"warnings":[]}`.',
    },
  ],
  handler: (context) => runDocDelete(context),
};
