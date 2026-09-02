import {
  bodyFlags,
  BODY_SOURCES_HELP,
  MODEL_FLAG,
  requireBody,
  resolveTurnModel,
  warningSuffix,
  type InputDependencies,
  JOB_FLAG,
  resolveJob,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { requireDeclaredModel } from "./declared-models.js";

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
 * Byte-for-byte is not the same as always accepted, and the help says so.
 * SERVER-075 and SERVER-076 added two **write-time** refusals on this path: a
 * body that leaves a code fence open (every later turn in the thread would be
 * swallowed into it and become invisible to every reader) and a body carrying a
 * bare `## <author> · <ts>` line (§6 reads it as a turn delimiter, so the message
 * splits into turns signed by someone who never wrote them). They are the
 * server's, not re-implemented here — but a help text promising verbatim
 * pass-through and silent about them is a help text that teaches an agent to
 * expect a `201` it will not get.
 *
 * Participation is not the CLI's decision either (SPEC.md §8): whether the turn
 * enqueues a `comment.created` event depends on the thread's state and on
 * `@agent` in the text, both of which the server judges. The response's
 * `eventId` is what actually happened, and it is printed.
 *
 * Nor is the thread's **status**. SERVER-062 made a person's turn reopen a
 * resolved thread as part of this same write, and the enqueue question is then
 * asked against the reopened status — so `--from` decides two things here, not
 * one, and the response's `thread.status` is the answer to the second. The help
 * used to say a resolved thread enqueued only on an explicit `@agent`, which
 * that change falsified; the reply verb is now a third door onto `status: open`
 * beside `corpus thread reopen`.
 */

export async function runThreadReply(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const job = resolveJob(context.flags, context.env);
  const id = context.args.get("id");
  // Before the body is read: a `--model` this actor may not state is a usage
  // error whatever the body turns out to be, and a heredoc consumed on the way
  // to a refusal is a heredoc the caller has to type again.
  const model = resolveTurnModel(context);
  // Also before the body is read: the value must be one the workspace's own
  // tier table declares (AGENT-061 — `declared-models.ts` has the whole story).
  // Skipped entirely when no model was stated, so an unstamped turn costs no
  // extra request.
  if (model !== undefined) await requireDeclaredModel(context, model);
  // The contract's `body` is `min(1)`: an empty reply is a usage error here
  // rather than a request the server was always going to reject.
  const body = await requireBody(context, "reply body", dependencies);

  const response = await context.client.request((api) =>
    api.POST("/api/threads/{id}/turns", {
      params: { path: { id } },
      // Spread rather than `model` unconditionally, so an unstated model is an
      // **absent field** rather than a null or an empty string: SPEC.md §10
      // wants a turn nobody recorded a model for to show nothing at all, and
      // absence having one spelling is what makes that checkable.
      // SPEC.md §9.2's job travels the same way, and for the same reason:
      // absent has one spelling, the field omitted (CLI-044).
      body: {
        body,
        ...(model === undefined ? {} : { model }),
        ...(job === undefined ? {} : { job }),
      },
    }),
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
    "enqueues a `comment.created` event and the printed line names it.\n\n" +
    "**A person's turn reopens a resolved thread** (SPEC.md §8), in the same write that appends " +
    "it: `status` goes back to `open` and §8's ordinary rules then apply to the reopened " +
    "thread, so an ordinary reply on an `engaged` thread enqueues with no `@agent` mention " +
    "needed. Resolved is a closed door, not a locked one. A turn written by the agent " +
    "(`--from agent`) never reopens and never re-triggers — the silence resolving buys is " +
    "silence from the agent, not from the person. The body is passed through unchanged — fenced code blocks (a " +
    "` ```form ` fence among them) and interior newlines all survive verbatim.\n\n" +
    "**Two body shapes are refused rather than written** (`400`, exit 5, nothing appended), and " +
    "the refusal names the offending line. A body that leaves a code fence open would swallow " +
    "every later turn in the thread into it, leaving them on disk but invisible to the board, " +
    "the projection and the agent — close it with a line holding nothing but the backtick run. A " +
    "body carrying a bare `## user · <ts>` or `## agent · <ts>` line would be read as SPEC.md " +
    "§6's turn delimiter and split the message into turns attributed to someone who never wrote " +
    "them. Both apply to every actor: neither failure depends on who typed it. Quoting either " +
    "shape is ordinary content and is accepted — a fence opened wider and closed on its own " +
    "line, and a turn heading inside a fence, an inline code span or a block quote, all go " +
    "through untouched.\n\n" +
    "**`--model` states what wrote the turn**, and only an agent's turn may carry one (SPEC.md " +
    "§10). It is a record of what ran, not a request for anything to run, and the value must be " +
    "one of the model names the workspace's own tier table declares — any other spelling is a " +
    "usage error (exit 2) that lists the declared names, with nothing sent (AGENT-061). Omit it " +
    "and the turn carries no model at all, which reads as nothing rather than as a guess.\n\n" +
    BODY_SOURCES_HELP,
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [...bodyFlags("The turn body"), MODEL_FLAG, JOB_FLAG],
  examples: [
    {
      command:
        "corpus thread reply th_a1b2c3 --from agent --model \"Opus 5\" <<'CORPUS_EOF'\nI filed the note under finance/.\nCORPUS_EOF",
      description:
        "The agent's form: a heredoc reply, authored by the agent, stating the model that wrote " +
        "it (SPEC.md §7, §10).",
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
