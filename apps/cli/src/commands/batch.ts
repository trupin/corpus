import { MAX_PAGE_LIMIT } from "@corpus/contract";
import { z } from "zod";
import { createClient, type CliClient } from "../client.js";
import { resolveCommand, type Resolution } from "../dispatch.js";
import {
  BatchFailedError,
  renderError,
  ServerResponseError,
  ServerUnreachableError,
  toProblem,
  UsageError,
  type CliProblem,
} from "../errors.js";
import {
  plural,
  readAll,
  resolveActor,
  stdinCarriesABody,
  stdinKind,
  stdinSocketRefusal,
  stdinStream,
  type InputDependencies,
} from "../input.js";
import { createNestedOutput } from "../output.js";
import { bindPositionals, parseFlags, type ParsedArgs, type ParsedFlags } from "../parse-args.js";
import type {
  CommandSpec,
  WorkspaceCommandContext,
  WorkspaceCommandSpec,
} from "../registry/types.js";

/**
 * `corpus batch` — several commands, one process (CLI-064). A `corpus`
 * invocation costs ~159 ms of fixed startup before it does anything (CLI-058),
 * and the agent loop is made of multi-call sequences — brief, work, log, reply —
 * that pay it once per call. CLI-057 collapsed that cost for one verb over many
 * ids; this verb generalises it to many commands, which is where the count is.
 *
 * The semantics were decided before the verb was built (the issue records the
 * decisions and what each rejected alternative would have cost):
 *
 * - **Every command runs.** A failure about one command — a `404`, a stale key,
 *   a patch refusal — costs that command and nothing else. A failure about the
 *   *run* — the server unreachable, a rejected token — ends the batch where it
 *   happens, and the remaining commands are reported as never run: pressing on
 *   would manufacture up to 199 copies of one fact (CLI-057's argument,
 *   transferred whole).
 * - **The report distinguishes three states positionally**: ran and succeeded,
 *   ran and failed, never ran. "Absent from the array" is not an answer, so
 *   every entry carries `ran`, and `value` is `null` rather than absent when a
 *   command emitted nothing — "ran and returned nothing" is written down.
 * - **A batch is not a transaction**, and the help says so in so many words:
 *   §4's commit window may fold several writes into one git commit, and a
 *   reader who saw that would assume an atomicity nobody promised.
 * - **Exit 0 means all succeeded; anything else is exit 11** (`batch_failed`),
 *   a code of its own because the caller's next move — read the per-command
 *   report — is one no existing code names.
 *
 * Commands arrive as JSON on stdin rather than as quoted shell strings: every
 * token reaches the command byte-exact with no shell in between, which is what
 * makes `-m` safe for carried bodies inside a batch — the workspace skills'
 * heredoc discipline exists because the shell mangles flag arguments, and a
 * JSON string cannot be mangled. The batch owns stdin, so an entry that would
 * fall back to reading a body from stdin deterministically finds none.
 *
 * Execution is sequential, in order (CLI-057 decision 6): the report stays in
 * the order sent by construction, and each entry's failure is exactly the
 * failure the lone invocation would have raised.
 */

/**
 * The most commands one batch may run — `MAX_PAGE_LIMIT`, CLI-057's ceiling for
 * the same reason: exceeding it is refused **before anything runs**, with the
 * cap stated (§10's stated-cap rule), never quietly truncated.
 */
export const MAX_BATCH_COMMANDS = MAX_PAGE_LIMIT;

const BatchInputSchema = z.array(z.array(z.string()));

/**
 * One entry of the report — the shape the whole verb exists to emit. `ran`
 * distinguishes "never ran" from every other state; `ok` and its payload exist
 * only where something happened to report.
 */
export interface BatchEntryReport {
  /** The entry's argv, echoed exactly as it was sent. */
  readonly command: readonly string[];
  readonly ran: boolean;
  readonly ok?: boolean;
  /** The command's own `--json` value; `null` when it emitted none. */
  readonly value?: unknown;
  readonly error?: CliProblem;
}

/** An entry resolved, parsed and validated — nothing runs until all of them are. */
interface PreparedEntry {
  readonly argv: readonly string[];
  readonly command: WorkspaceCommandSpec;
  readonly args: ParsedArgs;
  readonly flags: ParsedFlags;
  /**
   * The entry's own `--from` if it names one, otherwise the batch's resolution
   * (`--from` on the batch ?? `CORPUS_FROM` ?? `user`) — the same chain a lone
   * invocation walks, with the batch standing in for the shell. Resolved in
   * pre-flight so a misspelled actor refuses the whole batch before anything
   * runs, exactly as it refuses a lone invocation before any request.
   */
  readonly actor: WorkspaceCommandContext["actor"];
  readonly label: string;
}

export async function runBatch(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const entries = await readBatchInput(dependencies);
  const prepared = entries.map((argv, index) => prepareEntry(context, argv, index + 1));

  const timeoutMs = context.flags.number("timeout");
  const clients = new Map<string, CliClient>();
  const clientFor = (actor: WorkspaceCommandContext["actor"]): CliClient => {
    const cached = clients.get(actor);
    if (cached !== undefined) return cached;
    const built = createClient({
      workspace: context.workspace,
      actor,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    clients.set(actor, built);
    return built;
  };

  const reports: BatchEntryReport[] = [];
  let aborted = false;

  for (const [index, entry] of prepared.entries()) {
    if (index > 0) context.out.line("");
    context.out.line(entryRule(index + 1, entry.label));

    if (aborted) {
      reports.push({ command: entry.argv, ran: false });
      context.out.line("not run.");
      continue;
    }

    const nested = createNestedOutput(context.out, "");
    try {
      await entry.command.handler({
        args: entry.args,
        flags: entry.flags,
        out: nested.output,
        cwd: context.cwd,
        env: context.env,
        version: context.version,
        registry: context.registry,
        workspace: context.workspace,
        client: clientFor(entry.actor),
        actor: entry.actor,
      });
      reports.push({ command: entry.argv, ran: true, ok: true, value: nested.value() ?? null });
    } catch (error) {
      reports.push({ command: entry.argv, ran: true, ok: false, error: toProblem(error) });
      for (const line of renderError(error, { verbose: false }).trimEnd().split("\n")) {
        context.out.line(line);
      }
      if (endsTheBatch(error)) aborted = true;
    }
  }

  context.out.emit(reports);

  const failed = reports.flatMap((report, index) => (report.ok === false ? [index + 1] : []));
  const notRun = reports.flatMap((report, index) => (report.ran ? [] : [index + 1]));

  if (failed.length === 0) {
    context.out.line("");
    context.out.line(`all ${plural(reports.length, "command")} succeeded.`);
    return;
  }

  const total = String(reports.length);
  const summary =
    notRun.length === 0
      ? `${String(failed.length)} of ${total} commands failed; every command ran.`
      : `${String(failed.length)} of ${total} commands failed and ` +
        `${plural(notRun.length, "never ran", "never ran")} — a failure about the run, not ` +
        `about one command, ended the batch at command ${String(failed.at(-1))}.`;

  throw new BatchFailedError(summary, {
    hint:
      "Each command's outcome is in the report on stdout — under `--json`, one entry per " +
      "command in the order sent, carrying `ran` and `ok`. What succeeded stays done: a batch " +
      "is not a transaction, so fix and resend only the commands that failed or never ran.",
    details: { failed, notRun },
  });
}

/**
 * A failure that is a fact about the **run** rather than about one command:
 * nothing was listening, or the workspace token was rejected. Every remaining
 * command would fail identically, so the batch ends and reports them as never
 * run instead of collecting the same fact once per entry.
 */
function endsTheBatch(error: unknown): boolean {
  if (error instanceof ServerUnreachableError) return true;
  return error instanceof ServerResponseError && error.status === 401;
}

const HEREDOC_HINT =
  "Give the commands on stdin as a JSON array of commands, each itself an array of strings — " +
  "the argv you would have given `corpus`: `corpus batch <<'CORPUS_EOF'` … " +
  '`[["doc","show","doc_a1b2c3"],["thread","resolve","th_x9y8","--from","agent"]]` … ' +
  "`CORPUS_EOF`.";

async function readBatchInput(
  dependencies: InputDependencies,
): Promise<readonly (readonly string[])[]> {
  const kind = dependencies.stdinKind ?? stdinKind();
  if (kind === "socket") {
    throw stdinSocketRefusal(
      "command list",
      "Give the commands on a heredoc or a pipe — the two transports that are read.",
      { mayBeOmitted: false },
    );
  }
  if (!stdinCarriesABody(kind)) {
    throw new UsageError("no commands on stdin — a batch reads what to run from there.", {
      hint: HEREDOC_HINT,
    });
  }

  const raw = await readAll(dependencies.stdin ?? stdinStream());
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new UsageError("the batch on stdin is not JSON.", { hint: HEREDOC_HINT, cause });
  }

  const parsed = BatchInputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue === undefined || issue.path.length === 0
        ? "the top level"
        : `command ${String(Number(issue.path[0]) + 1)}`;
    throw new UsageError(
      `the batch must be a JSON array of commands, each an array of strings — ${where} is not.`,
      { hint: HEREDOC_HINT },
    );
  }

  if (parsed.data.length === 0) {
    throw new UsageError("the batch is empty — it names no command to run.", {
      hint: HEREDOC_HINT,
    });
  }
  if (parsed.data.length > MAX_BATCH_COMMANDS) {
    throw new UsageError(
      `at most ${String(MAX_BATCH_COMMANDS)} commands can run in one batch, and ` +
        `${String(parsed.data.length)} were given.`,
      {
        hint:
          "Nothing was run. Split the batch: what succeeded in an earlier batch stays done, so " +
          "consecutive batches compose exactly like one longer one.",
      },
    );
  }
  return parsed.data;
}

/**
 * Flags an entry may not carry, because each is a property of the invocation
 * rather than of one command: rendering is decided once for the whole batch,
 * help is not data, and one batch acts on one workspace. `--timeout` is the
 * batch's for the same reason and is applied to every entry's client.
 */
const INVOCATION_FLAGS = ["json", "help", "version", "workspace", "no-color", "verbose"] as const;

/**
 * Resolution and parsing of one entry, **before anything runs**: a batch that
 * is malformed anywhere is refused whole at exit 2, because running the
 * well-formed half of a mistyped batch would leave the caller reasoning about
 * partial state — the reasoning a batch exists to remove — while a refusal
 * leaves the whole batch its author's to fix and resend.
 */
function prepareEntry(
  context: WorkspaceCommandContext,
  argv: readonly string[],
  position: number,
): PreparedEntry {
  const label = commandLabel(argv);
  const refuse = (problem: string, hint?: string): never => {
    throw new UsageError(`command ${String(position)} (${label}) ${problem}`, {
      hint: `${hint ?? ""}${hint === undefined ? "" : " "}Nothing was run.`,
    });
  };

  let resolution: Resolution;
  try {
    resolution = resolveCommand(context.registry, argv);
  } catch (cause) {
    return refuse(
      `is not a command this tool has${cause instanceof Error ? ` — ${cause.message}` : "."}`,
      cause instanceof UsageError && cause.hint !== undefined ? cause.hint : undefined,
    );
  }

  if (resolution.kind !== "command") {
    return refuse(
      resolution.kind === "topic-help"
        ? `names the topic \`${resolution.topic.name}\` without a verb, so there is nothing to run.`
        : "asks for help or the version, which are not work a batch can report on.",
      'Name a full command per entry, `["doc","show","doc_a1b2c3"]`-shaped.',
    );
  }

  const spec: CommandSpec = resolution.command;
  if (spec.requiresWorkspace === false) {
    return refuse(
      `runs without a workspace, so it cannot run inside a batch — a batch acts on exactly one.`,
    );
  }
  if (resolution.topic === undefined && spec.name === "batch") {
    return refuse("is a batch — a batch inside a batch is a grammar with no additional power.");
  }
  if (resolution.topic === undefined && spec.name === "upgrade") {
    return refuse(
      "replaces the running tool and restarts the server the rest of the batch is talking to.",
      "Run `corpus upgrade` on its own.",
    );
  }

  let parsed: { readonly flags: ParsedFlags; readonly positionals: readonly string[] };
  let args: ParsedArgs;
  let actor: WorkspaceCommandContext["actor"];
  try {
    parsed = parseFlags(spec, resolution.tokens);
    args = bindPositionals(spec, parsed.positionals);
    actor =
      parsed.flags.string("from") === undefined
        ? context.actor
        : resolveActor(parsed.flags, context.env);
  } catch (cause) {
    return refuse(
      `does not parse${cause instanceof Error ? ` — ${cause.message}` : "."}`,
      cause instanceof UsageError && cause.hint !== undefined ? cause.hint : undefined,
    );
  }

  for (const name of INVOCATION_FLAGS) {
    const carried =
      name === "help" ? parsed.flags.string(name) !== undefined : flagGiven(parsed.flags, name);
    if (carried) {
      return refuse(
        `names --${name}, which belongs to the batch invocation — it is decided once for the whole batch.`,
        name === "json"
          ? "Pass `--json` to `corpus batch` itself: each entry's machine value then arrives in the report."
          : undefined,
      );
    }
  }

  return { argv, command: spec, args, flags: parsed.flags, actor, label };
}

/**
 * Whether one of the boolean invocation flags was given. `--workspace` is the
 * one string among them and has no default, so presence is its parsed value.
 */
function flagGiven(flags: ParsedFlags, name: string): boolean {
  return name === "workspace" ? flags.string(name) !== undefined : flags.boolean(name);
}

const MAX_LABEL = 60;

/** The entry's argv as one display label — the JSON report carries it exact. */
function commandLabel(argv: readonly string[]): string {
  const joined = argv.join(" ");
  return joined.length <= MAX_LABEL ? joined : `${joined.slice(0, MAX_LABEL - 1)}…`;
}

/**
 * The rule above each entry in the human rendering — CLI-057's `U+2500` rule,
 * for CLI-057's reason: a command's own output may open a line with `-` or `=`,
 * and a separator a body can forge is not a separator. It carries the position
 * so `sed -n '/^──────── 3: /,/^────────/p'` cuts one entry out of the stream;
 * a caller that needs certainty uses `--json`.
 */
export function entryRule(position: number, label: string): string {
  const rule = "─".repeat(8);
  return `${rule} ${String(position)}: ${label} ${rule}`;
}

export const batchCommand: WorkspaceCommandSpec = {
  name: "batch",
  summary: "Run several commands in one invocation, with a per-command report.",
  description:
    "Runs the commands given on stdin, in order, in one process — and one `corpus` invocation " +
    "costs ~159 ms of fixed startup before any work happens (CLI-058), so a sequence the agent " +
    "loop makes as five calls costs ~1 s of pure startup that one batch pays once. The commands " +
    "arrive as a **JSON array of commands, each itself an array of strings** — exactly the argv " +
    "you would have given `corpus`, without the word `corpus`. No shell touches the tokens, so " +
    'a body travels safely as a `-m` value inside the entry — `["thread","reply","th_x9y8",' +
    '"--from","agent","-m","The figure moved to 6.4%."]` — with none of the heredoc ceremony a ' +
    "shell needs. The batch owns stdin, so an entry cannot read a body from there: give bodies " +
    "with `-m` or `--file`.\n\n" +
    "**A batch is not a transaction.** Every command that succeeds stays done, whatever fails " +
    "after it. Corpus commits through §4's window, so several writes may land as one git commit " +
    "— that is an artifact of timing, **not** a promise of atomicity, and nothing rolls back. " +
    "Plan a batch as what it is: the same commands you would have run one by one, minus the " +
    "startup cost.\n\n" +
    "**Every command runs, and the report says what each one did.** A failure about one command " +
    "— a missing id, a stale key, a refused patch — costs that command alone; the ones after it " +
    "still run. A failure about the _run_ — the server unreachable, a rejected token — ends the " +
    "batch where it happens, since every remaining command would fail the same way, and the " +
    "remaining entries are reported as **never run**. Exit 0 means every command ran and " +
    "succeeded; anything else is exit 11, and the per-command report is the answer to what " +
    "happened.\n\n" +
    "Under `--json`, stdout carries one array with **one entry per command, in the order " +
    'sent**: `{"command":[…],"ran":true,"ok":true,"value":…}` for a success (`value` is the ' +
    'command\'s own `--json` value, `null` when it emits none), `"ok":false` with `error` — ' +
    "the same `{code,message,hint,…}` object a lone failure's envelope carries — for a " +
    'failure, and `{"command":[…],"ran":false}` for an entry that never ran. So _did not run_ ' +
    "is always distinguishable from _ran and returned nothing_. On failure, stderr adds the " +
    "summary envelope with `details.failed` and `details.notRun` as 1-based positions. The " +
    "human rendering prints each command's ordinary output under a `──────── <n>: <command> " +
    "────────` rule, `failed — `-style lines for a failure, and `not run.` for the rest.\n\n" +
    "**Refused whole, before anything runs** (exit 2): a batch with any entry that does not " +
    "resolve and parse — unknown verb, unknown flag, missing argument — plus an empty batch " +
    "and one of more than 200 commands. An entry may not carry `--json`, `--help`, " +
    "`--version`, `--no-color`, `--verbose` or `--workspace` — those belong to the batch " +
    "invocation — and may not be `batch` itself, `corpus upgrade`, or a command that runs " +
    "without a workspace (`corpus init`). `--from` and `--timeout` on the batch apply to every " +
    "entry; an entry's own `--from` wins over the batch's.\n\n" +
    "One command's output cannot feed another's input — entries are fixed before the first " +
    "one runs. A sequence where a later command needs an earlier one's answer is two " +
    "invocations, and the second can be a batch. A long-polling entry (`queue idle`) holds " +
    "the batch exactly as it would hold a shell.",
  args: [],
  flags: [],
  examples: [
    {
      command:
        "corpus batch <<'CORPUS_EOF'\n" +
        '[["doc","patch","doc_a1b2c3","--from","agent","--old","6.1%","--new","6.4%"],\n' +
        ' ["job","log","evt_7c1d9a","updated the rate assumption"],\n' +
        ' ["thread","reply","th_4b8e2c","--from","agent","-m","Updated the assumption to 6.4%. ↳ updated [[doc_a1b2c3]]"]]\n' +
        "CORPUS_EOF",
      description:
        "A worked event's write tail — patch, log, reply — as one invocation: three commands, one startup cost. The `-m` value is a JSON string, so the shell never touches the body.",
    },
    {
      command:
        "corpus batch --json <<'CORPUS_EOF'\n" +
        '[["doc","show","doc_a1b2c3"],["doc","show","doc_nosuchid"],["thread","show","th_4b8e2c"]]\n' +
        "CORPUS_EOF",
      description:
        'One array on stdout, one entry per command in the order sent. The missing id costs its own entry alone — `{"command":["doc","show","doc_nosuchid"],"ran":true,"ok":false,"error":{"code":"not_found",…}}` — and the third command still runs. Exit 11; stderr names positions in `details.failed`.',
    },
    {
      command: "corpus batch --from agent --json < commands.json",
      description:
        "The batch's `--from` is the default actor for every entry that names none — the same standing an exported `CORPUS_FROM` would have. An entry's own `--from` still wins.",
    },
  ],
  handler: (context) => runBatch(context),
};
