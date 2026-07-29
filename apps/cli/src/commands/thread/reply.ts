import { bodyFlags, requireBody, warningSuffix, type InputDependencies } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus thread reply <id> --from agent` — the literal command SPEC.md §7's
 * comment skill is written in, and the reason the body-source helper exists: the
 * agent's replies are prose, and prose arrives as a heredoc.
 *
 * The body is sent byte-for-byte. A ```` ```form ```` fence, any other fenced
 * code block or a trailing newline reach the thread file exactly as they were
 * typed — there is no markdown post-processing anywhere in the CLI. (Backtick
 * fences, deliberately: `~~~form` is not a form fence — the contract's settled
 * grammar, CONTRACT-014.)
 *
 * Participation is not the CLI's decision either (SPEC.md §8): whether the turn
 * enqueues a `comment.created` event depends on the thread's state and on
 * `@agent` in the text, both of which the server judges. The response's
 * `eventId` is what actually happened, and it is printed.
 */

export async function runThreadReply(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const id = context.args.get("id");
  // The contract's `body` is `min(1)`: an empty reply is a usage error here
  // rather than a request the server was always going to reject.
  const body = await requireBody(context, "reply body", dependencies);

  const response = await context.client.request((api) =>
    api.POST("/api/threads/{id}/turns", { params: { path: { id } }, body: { body } }),
  );

  context.out.emit(response);
  const queued = response.eventId === null ? "" : ` (queued ${response.eventId})`;
  context.out.line(
    `replied to ${id} — turn ${response.turn.ts}${queued}${warningSuffix(response.warnings)}`,
  );
}

export const replyCommand: WorkspaceCommandSpec = {
  name: "reply",
  summary: "Append a turn to a thread.",
  description:
    "Reads the turn's body from `-m`, `--file` or stdin — the heredoc form the comment skill " +
    "uses — and appends it to the thread, committed with `--from` as the git author. An empty " +
    "body is a usage error (exit 2), never a request. Whether the turn wakes the agent is the " +
    "server's call (SPEC.md §8): a turn in an `engaged` thread, or one mentioning `@agent`, " +
    "enqueues a `comment.created` event and the printed line names it. Resolving a thread stops " +
    "only the automatic re-trigger — an explicit `@agent` mention (or `/skill` invocation) in " +
    "a resolved thread still enqueues, because resolved is not a mute button on someone " +
    "deliberately asking. The body is passed through unchanged — fenced code blocks (a " +
    "` ```form ` fence among them) and interior newlines all survive verbatim.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [...bodyFlags("The turn body")],
  examples: [
    {
      command:
        "corpus thread reply th_a1b2c3 --from agent <<'EOF'\nI filed the note under finance/.\nEOF",
      description: "The agent's form: a heredoc reply, authored by the agent (SPEC.md §7).",
    },
    {
      command: 'corpus thread reply th_a1b2c3 -m "one more thought"',
      description: "A short reply from the user, inline.",
    },
    {
      command: "corpus thread reply th_a1b2c3 --file answer.md --json",
      description:
        "One JSON value carrying `thread`, `turn` (with its `ts`), `eventId` and `warnings`.",
    },
  ],
  handler: (context) => runThreadReply(context),
};
