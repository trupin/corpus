import { UsageError } from "../../errors.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The console feed (SPEC.md §7): while working a job the agent appends progress
 * lines that all converge on `.corpus/jobs/<eventId>.jsonl`, and the UI's
 * bottom drawer tails them live.
 *
 * It is called many times per job, so it stays one small `POST` with no extra
 * round trips and no output in human mode.
 *
 * `POST /api/jobs/{id}/log` also accepts loopback-only **tokenless** appends —
 * that hole exists for Claude Code hooks like `PostToolUse`, which hold no
 * token. The CLI is not a hook: it holds the workspace token and sends it like
 * every other request. Stripping it to imitate the hook path would exercise a
 * different code path than the one the agent actually uses.
 */

export interface JobLogDependencies {
  /** Source for the line when the positional is omitted; defaults to the process's stdin. */
  readonly stdin?: AsyncIterable<string | Uint8Array>;
}

export async function readAll(stream: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function runJobLog(
  context: WorkspaceCommandContext,
  dependencies: JobLogDependencies = {},
): Promise<void> {
  const id = context.args.get("event-id");
  const positional = context.args.optional("line");
  // Only the shell's own trailing newline is stripped: interior newlines are
  // part of the line, and framing the file is the server's job, not the CLI's.
  const line =
    positional ?? (await readAll(dependencies.stdin ?? process.stdin)).replace(/\r?\n$/, "");

  if (line === "") {
    throw new UsageError("no line to append.", {
      hint: 'Pass the line as an argument, or pipe it in: `echo "step 1" | corpus job log <event-id>`.',
    });
  }

  const result = await context.client.request((api) =>
    api.POST("/api/jobs/{id}/log", { params: { path: { id } }, body: { line } }),
  );
  // Silent in human mode — this runs many times per job and its output would be
  // noise. `--json` carries `appended`, which is not always true: a log at its
  // size cap still answers 201 and drops the line.
  context.out.emit(result);
}

export const logCommand: WorkspaceCommandSpec = {
  name: "log",
  summary: "Append a progress line to a job's log.",
  description:
    "Appends to `.corpus/jobs/<event-id>.jsonl`, which the console's drawer tails live, and " +
    "answers nothing in human mode: this is called many times while working one job. Omit the " +
    "line and it is read from stdin instead, so a hook or a heredoc can pipe it in. Newlines " +
    "inside the line are preserved and sent as one request — the server owns the file's framing. " +
    "Under `--json` the response carries `appended`, which is `false` when the log has hit its " +
    "size cap and the line was dropped. An unknown event id is a server error (exit 5).",
  args: [
    { name: "event-id", required: true, description: "The job's event id." },
    {
      name: "line",
      required: false,
      description: "The progress line. Read from stdin when omitted.",
    },
  ],
  flags: [],
  examples: [
    {
      command: 'corpus job log evt_9f2a "reading the thread"',
      description: "Record a step while working an event.",
    },
    {
      command: "corpus job log evt_9f2a < step.txt",
      description:
        "Take the line from stdin instead of an argument — the form a hook or a heredoc pipes into.",
    },
  ],
  handler: (context) => runJobLog(context),
};
