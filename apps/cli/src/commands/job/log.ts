import { UsageError } from "../../errors.js";
import {
  readAll,
  stdinCarriesABody,
  stdinKind,
  stdinSocketRefusal,
  stdinStream,
  type InputDependencies,
} from "../../input.js";
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

/** The same two knobs every body-taking verb has, so stdin behaves identically across them. */
export type JobLogDependencies = Pick<InputDependencies, "stdin" | "stdinKind">;

const LINE_REPAIR =
  'Pass the line as an argument — `corpus job log <event-id> "step 1"` — or on a heredoc or a ' +
  "pipe, which are read.";

/**
 * The positional, else a stdin that actually carries a body.
 *
 * The `stdinKind()` probe is the whole point (CLI-007): this verb's caller is
 * the orchestrate skill running inside an agent harness, which hands its child a
 * **socket** on fd 0 that is never written to and never closed. Reading it
 * because "stdin is not a TTY" blocks forever, parking the agent mid-job with no
 * way to see why. A socket is not a body source; a heredoc's regular file and a
 * pipe's FIFO are, and both still read exactly as before.
 *
 * The socket is refused **by name** rather than folded into the generic "no line
 * to append" (CLI-066): that message told a `spawnSync({ input })` caller to
 * pipe the line in, which is precisely what it had just done, on the one
 * transport that is never read. The positional is checked first, so the agent's
 * normal call under its harness never reaches this at all.
 */
async function resolveLine(
  context: WorkspaceCommandContext,
  dependencies: JobLogDependencies,
): Promise<string> {
  const positional = context.args.optional("line");
  if (positional !== undefined) return positional;

  const kind = dependencies.stdinKind ?? stdinKind();
  if (kind === "socket") throw stdinSocketRefusal("line", LINE_REPAIR, { mayBeOmitted: false });
  if (!stdinCarriesABody(kind)) return "";

  // Only the shell's own trailing newline is stripped: interior newlines are
  // part of the line, and framing the file is the server's job, not the CLI's.
  return (await readAll(dependencies.stdin ?? stdinStream())).replace(/\r?\n$/, "");
}

export async function runJobLog(
  context: WorkspaceCommandContext,
  dependencies: JobLogDependencies = {},
): Promise<void> {
  const id = context.args.get("event-id");
  const line = await resolveLine(context, dependencies);

  if (line === "") {
    throw new UsageError("no line to append.", {
      hint:
        'Pass the line as an argument, or pipe it in: `echo "step 1" | corpus job log <event-id>`. ' +
        "Stdin is read only when it is a pipe or a heredoc.",
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
    "line and it is read from stdin instead — but only when stdin is a pipe or a heredoc, never " +
    "from a terminal and never from a **socket**, which is what `spawn`, `exec`, " +
    "`spawnSync({ input })` and an agent harness all hand a child: waiting for a line nobody is " +
    "sending would hang the job, so a socket with no line argument is refused by name (exit 2, " +
    "nothing appended) rather than logged as an empty step. Newlines " +
    "inside the line are preserved and sent as one request — the server owns the file's framing. " +
    "Under `--json` the response carries `appended`, which is `false` when the log has hit its " +
    "size cap and the line was dropped. An unknown event id is a server error (exit 5).",
  args: [
    { name: "event-id", required: true, description: "The job's event id." },
    {
      name: "line",
      required: false,
      description: "The progress line. Read from a piped stdin when omitted.",
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
