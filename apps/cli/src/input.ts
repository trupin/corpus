import { fstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ACTORS, CommitShaSchema, DEFAULT_ACTOR, type Actor, type Warning } from "@corpus/contract";
import { UsageError } from "./errors.js";
import type { ParsedFlags } from "./parse-args.js";
import type { CommandContext, WorkspaceCommandContext } from "./registry/types.js";
import type { FlagSpec } from "./registry/types.js";

/**
 * The two inputs every mutating verb shares: **who is acting** and **where the
 * body comes from**. Both are resolved here so that `doc create`, `doc edit` and
 * `thread reply` cannot disagree about precedence — a heredoc that behaves
 * differently between two verbs is exactly the kind of surprise the agent has no
 * way to debug.
 *
 * Reading a file or stdin is a *read*. The CLI never writes to the workspace
 * (CLAUDE.md Architecture Decision 2): every byte it produces goes to the server.
 */

/** Environment override for the acting party, below `--from` and above the default. */
export const ACTOR_ENV_VAR = "CORPUS_FROM";

/**
 * `--from` is **global** rather than per-verb: the actor is resolved once in the
 * dispatcher and handed to the client, so every request carries it and no verb
 * can forget to. Registry validation then forbids a command from redeclaring the
 * name, which is what keeps "resolved once" true.
 */
export const FROM_FLAG: FlagSpec = {
  name: "from",
  type: "string",
  valueName: "user|agent",
  description:
    "Who is acting, and therefore the git author of the server's auto-commit: `user` or `agent`. " +
    `Defaults to \`${DEFAULT_ACTOR}\`; set \`${ACTOR_ENV_VAR}=agent\` to change the default for a ` +
    "session, and this flag still wins over it. Anything else is a usage error (exit 2) and no " +
    "request is sent.",
};

function isActor(value: string): value is Actor {
  return (ACTORS as readonly string[]).includes(value);
}

/**
 * `--from` ?? `CORPUS_FROM` ?? `user` (sprint-007 Open Conflict 4). A human
 * typing `corpus doc create` is a user; the agent's skills pass `--from agent`
 * explicitly, exactly as SPEC.md §7 writes them. Resolved before the workspace
 * is even located, so a misspelled actor is a usage error rather than a `400`
 * the server had to be asked for.
 */
export function resolveActor(
  flags: ParsedFlags,
  env: Readonly<Record<string, string | undefined>>,
): Actor {
  const flag = flags.string("from");
  if (flag !== undefined) return validateActor(flag, `--from`);

  const fromEnv = env[ACTOR_ENV_VAR];
  if (fromEnv === undefined || fromEnv === "") return DEFAULT_ACTOR;
  return validateActor(fromEnv, ACTOR_ENV_VAR);
}

/**
 * A `--from` that is a **commit sha** is not a misspelled actor: it is one half
 * of a `doc.edited` event's range aimed at the wrong flag, because that event
 * calls it `from` and this global name is already taken. `corpus doc diff`
 * spells its range halves `--from-rev`/`--to-rev` for exactly that reason, and
 * the sentence saying so belongs where the mistake actually surfaces — the
 * dispatcher rejects the value before the verb it was meant for ever runs.
 */
function validateActor(value: string, source: string): Actor {
  if (isActor(value)) return value;
  throw new UsageError(`${source} must be one of: ${ACTORS.join(", ")} — got "${value}".`, {
    hint: CommitShaSchema.safeParse(value).success
      ? "That is a commit sha. A revision range belongs to `corpus doc diff <id> --from-rev " +
        "<sha> --to-rev <sha>`; `--from` names the acting party on every verb."
      : `Writes are attributed to \`${DEFAULT_ACTOR}\` unless ${source} says otherwise.`,
  });
}

/** The body flags shared by `doc create`, `doc edit` and `thread reply`. */
export function bodyFlags(what: string): readonly FlagSpec[] {
  return [
    {
      name: "message",
      alias: "m",
      type: "string",
      valueName: "text",
      description: `${what} as a literal string. Wins over --file and stdin.`,
    },
    {
      name: "file",
      type: "string",
      valueName: "path",
      description: `Read ${what.toLowerCase()} from this file. Wins over stdin; the file is only read.`,
    },
  ];
}

/**
 * `--model` — the model that **wrote** the turn, on the two verbs that write one
 * (`thread create`, `thread reply`). Shared here rather than declared twice for
 * the same reason `bodyFlags` is: two spellings of one idea drift.
 *
 * It is the CLI's whole part in SPEC.md §11's "an agent turn says which model
 * wrote it". The mechanism below it is complete — the contract carries the
 * field, the server records it in the thread's `turnModels` frontmatter and
 * projects it, the board renders it — and until this flag existed nothing
 * supplied a value, so every turn rendered blank (CLI-033, found by SERVER-074).
 *
 * Three properties, each of which is the reason for a line of code below:
 *
 *   - **It is a report, not an instruction.** It states what ran; it never asks
 *     for anything to run. It is deliberately not §7's *weight* (CONTRACT-039):
 *     a weight is stated before the work and must be "honoured, not weighed
 *     again", a claim only checkable while the two stay separate fields.
 *   - **The caller states it; the CLI never guesses.** A process cannot know
 *     which model is driving it, and a plausible default is exactly what §11's
 *     "nothing rather than a guess" forbids. So there is no default, no
 *     environment fallback and no inference — omitted means *no field at all*.
 *   - **It is a display string, not a validated set.** §7 keeps model names in
 *     the orchestrator skill, and CONTRACT-043 kept an enum off the wire so a
 *     workspace can change its tiers without touching the contract. Validating
 *     against a list here would freeze exactly what that took pains to leave
 *     editable, so nothing below inspects the value's content.
 */
export const MODEL_FLAG: FlagSpec = {
  name: "model",
  type: "string",
  valueName: "name",
  description:
    "The model that **wrote** this turn (SPEC.md §11), recorded with it so _which model wrote " +
    "this?_ stays answerable from the conversation itself, long after the job's log has been " +
    "reaped with its event (SPEC.md §7). It is a **report of what ran**, never a request for " +
    "what should run: it selects nothing, and it is not a weight (which is stated before the " +
    "work and honoured rather than weighed again — the two are separate on purpose). Where one " +
    "request ran in stages at different weights, name the model of the **deciding** stage, the " +
    "one that drew the conclusion or wrote the words. Any display string is accepted: the model " +
    "names live in the orchestrator skill, so nothing here validates against a list of them. " +
    "**Only an agent turn names a model** — with `--from user` (the default) this flag is a " +
    "usage error (exit 2) and nothing is sent, because a person's turn names no model. " +
    "**Omitted, no model is recorded at all** — not an empty one: a turn with no record shows " +
    "nothing rather than a guess, so state it only when you know what ran.",
};

/**
 * `--model` resolved into the request field, or into its absence.
 *
 * Absence has exactly **one** spelling, which is why a blank is refused rather
 * than sent: `--model ""` would otherwise become an attribution to a model with
 * no name, and §11 wants nothing at all in that case. The server refuses a blank
 * too — this refusal is the same answer, one round trip earlier, with nothing
 * written.
 *
 * The actor guard is the same shape `doc delete` uses: the
 * server's `400` ("only an agent turn names the model that wrote it") stays the
 * backstop, and this exists so the caller who forgot `--from agent` is told what
 * to do instead of being handed a status code. Refused before the flag's value
 * is even looked at, because the mistake is having stated one at all.
 */
export function resolveTurnModel(
  context: Pick<WorkspaceCommandContext, "flags" | "actor">,
): string | undefined {
  const model = context.flags.string("model");
  if (model === undefined) return undefined;

  if (context.actor !== "agent") {
    throw new UsageError(`only an agent turn names the model that wrote it.`, {
      hint:
        `A turn authored by \`${context.actor}\` names no model (SPEC.md §11). Pass \`--from ` +
        `agent\` when the agent wrote this turn, or drop --model. Nothing was sent to the server.`,
    });
  }

  if (model.trim() === "") {
    throw new UsageError("--model was given without a model name.", {
      hint:
        "Name the model that wrote the turn — `--model claude-opus-4-1` — or leave the flag out " +
        "entirely: a turn with no model recorded shows nothing, which is what an unknown should " +
        "show. A blank is not that, and nothing was sent to the server.",
    });
  }

  return model;
}

export interface InputDependencies {
  /** Defaults to the process's stdin; injectable so tests need no pipe. */
  readonly stdin?: AsyncIterable<string | Uint8Array>;
  /** Defaults to {@link stdinCarriesABody}. */
  readonly stdinIsBodySource?: boolean;
  /** Defaults to `node:fs/promises` `readFile`. Reading is the only filesystem access the CLI has. */
  readonly readTextFile?: (path: string) => Promise<string>;
}

/**
 * The process's stdin, and whether it is a terminal — the **only** two places in
 * the CLI that name `process.stdin`.
 *
 * Every command module goes through these accessors instead, and
 * `commands/hygiene.test.ts` enforces that by scanning the sources: the
 * socket-hang class CLI-007 closed (an agent harness's never-ending fd 0, read
 * because "not a TTY" was mistaken for "piped") is a mistake that can only be
 * made where `process.stdin` is reachable, so it is reachable in exactly one
 * file. A rule with per-file exemptions decays; this one has none.
 */
export function stdinStream(): NodeJS.ReadStream {
  return process.stdin;
}

export function stdinIsTTY(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Whether stdin is a thing a body could arrive on — and the reason this is a
 * `fstat` rather than the obvious `!process.stdin.isTTY`.
 *
 * A heredoc (`<<'EOF'`) is a **regular file**; `cmd | corpus` is a **FIFO**.
 * Both are read. A terminal is not read, because a body-optional verb must not
 * sit waiting for a human nobody asked.
 *
 * The case that forces the `fstat`: an agent harness — Claude Code's own Bash
 * tool among them — hands its child a **socket** on fd 0 that is never written
 * to and never closed. `isTTY` is false for it, so a naive "not a TTY means
 * piped" test reads it, blocks forever, and parks the agent on its first
 * `corpus doc create` with no body. A socket is therefore not a body source:
 * nothing in this CLI's documented usage passes a body over one.
 */
export function stdinCarriesABody(fd = 0): boolean {
  if (stdinIsTTY()) return false;
  try {
    const stats = fstatSync(fd);
    return stats.isFile() || stats.isFIFO();
  } catch {
    // No fd 0 at all (`0<&-`) is exactly "no body on stdin".
    return false;
  }
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

/**
 * `--message` > `--file` > piped stdin > nothing, resolved exactly once so the
 * request body is built from a single read.
 *
 * Bytes are passed through **verbatim**: no trailing-newline trimming, no
 * markdown processing, no CRLF rewriting. A ```` ```form ```` fence, any other
 * fenced code block and a heredoc's final newline all reach the server as
 * typed, and normalization stays the server's single implementation.
 *
 * A stdin that is a TTY is never read — a verb whose body is optional must not
 * hang waiting for a human who was not asked for one.
 */
export async function resolveBody(
  context: CommandContext,
  dependencies: InputDependencies = {},
): Promise<string | undefined> {
  const message = context.flags.string("message");
  if (message !== undefined) return message;

  const file = context.flags.string("file");
  if (file !== undefined) return readBodyFile(context, file, dependencies);

  if (!(dependencies.stdinIsBodySource ?? stdinCarriesABody())) return undefined;

  const piped = await readAll(dependencies.stdin ?? stdinStream());
  return piped === "" ? undefined : piped;
}

/** `resolveBody` for the verbs whose body is mandatory — `thread reply`. */
export async function requireBody(
  context: CommandContext,
  what: string,
  dependencies: InputDependencies = {},
): Promise<string> {
  const body = await resolveBody(context, dependencies);
  if (body === undefined || body === "") {
    throw new UsageError(`no ${what} to send.`, {
      hint: `Pass it with -m "…", with --file <path>, or pipe it in: \`… <<'EOF' … EOF\`.`,
    });
  }
  return body;
}

async function readBodyFile(
  context: CommandContext,
  file: string,
  dependencies: InputDependencies,
): Promise<string> {
  const path = isAbsolute(file) ? file : resolve(context.cwd, file);
  const read = dependencies.readTextFile ?? ((target: string) => readFile(target, "utf8"));
  try {
    return await read(path);
  } catch (cause) {
    throw new UsageError(`cannot read --file ${file}.`, {
      hint: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/** A flag the verb cannot act without; absence is a usage error, never a request. */
export function requireFlag(context: CommandContext, name: string, valueName: string): string {
  const value = context.flags.string(name);
  if (value === undefined || value === "") {
    throw new UsageError(`--${name} is required.`, { hint: `Usage: --${name} <${valueName}>` });
  }
  return value;
}

/** `--tags a,b` — commas, because a repeatable flag per tag is noise at creation time. */
export function splitTags(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/**
 * A `true|false` flag that must stay tri-state: absent means "do not change
 * this field", which a boolean flag cannot express (an absent boolean parses as
 * `false` and would silently rewrite the document).
 */
export function parseTriStateBoolean(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`--${name} expects "true" or "false", got "${value}".`);
}

/**
 * §14's warnings, folded onto the verb's single success line. Details are
 * collapsed to one line: a rejecting git hook's output is multi-line, and a
 * success message that spans lines breaks every caller parsing the last line.
 */
export function warningSuffix(warnings: readonly Warning[]): string {
  const [first, ...rest] = warnings;
  if (first === undefined) return "";
  if (rest.length === 0) return ` — warning: ${first.code} (${oneLine(first.detail)})`;
  return ` — ${String(warnings.length)} warnings: ${warnings.map((w) => w.code).join(", ")}`;
}

const MAX_DETAIL = 120;

function oneLine(detail: string): string {
  const collapsed = detail.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_DETAIL ? collapsed : `${collapsed.slice(0, MAX_DETAIL - 1)}…`;
}

/** "1 anchor" / "3 anchors", so the one-line reports read like English. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}
