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

export const JOB_ENV_VAR = "CORPUS_JOB";

/**
 * The queue event a write is doing the work of (SPEC.md §9.2, CLI-044).
 *
 * Modelled on `--from`/`CORPUS_FROM` rather than on `--model`, and the reason is
 * the whole point of the feature: **an agent exports `CORPUS_JOB` once when it
 * claims an event, and every write it makes afterwards is attributed without it
 * having to remember.** §9.2 is explicit that forgetting costs provenance rather
 * than correctness — nothing is refused — so a mechanism that relied on the
 * agent naming the job per command would be a mechanism that quietly stops
 * working, which is the failure §7's key was redesigned to escape.
 *
 * Shape only, client-side. Whether the id names a live event is the server's
 * `422` to answer (it reads the queue; the CLI does not), and validating
 * existence here would be a second source of truth about what is claimable.
 */
export const JOB_FLAG: FlagSpec = {
  name: "job",
  type: "string",
  valueName: "evt_…",
  description:
    "The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to " +
    "the thread that work came from and records it as the created document's `origin`, which is " +
    `what makes a conversation's artifacts findable. Set \`${JOB_ENV_VAR}=evt_…\` once when you ` +
    "claim an event and every write in that session carries it; this flag still wins over the " +
    "variable. **Omitting it is not an error** — the write lands and records no origin, so " +
    "forgetting costs provenance and never correctness. **Naming an event that does not exist, " +
    "or one already settled, is refused** (exit 5, the server's `422`): a caller that mistyped a " +
    "job id wanted the attribution, and quietly dropping it would leave it believing it had one.",
};

/**
 * `--job` ?? `CORPUS_JOB` ?? absent — and absence has one spelling, the field
 * omitted, because §9.2 gives a write with no job no origin rather than a null
 * one. An empty variable is treated as unset: `CORPUS_JOB=` is how a shell
 * clears it, and reading that as "the job named empty string" would turn a
 * clear into a `422`.
 */
export function resolveJob(
  flags: ParsedFlags,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const flag = flags.string("job");
  const raw = flag ?? env[JOB_ENV_VAR];
  if (raw === undefined || raw === "") return undefined;
  if (!raw.startsWith("evt_")) {
    throw new UsageError(`a job id looks like \`evt_…\`, got "${raw}"`, {
      hint:
        `Pass the id of the event you are working — the one \`corpus queue claim-all\` printed. ` +
        `If \`${JOB_ENV_VAR}\` is set to something stale, unset it or override it with \`--job\`.`,
    });
  }
  return raw;
}

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
 * It is the CLI's whole part in SPEC.md §10's "an agent turn says which model
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
 *     which model is driving it, and a plausible default is exactly what §10's
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
    "The model that **wrote** this turn (SPEC.md §10), recorded with it so _which model wrote " +
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
 * no name, and §10 wants nothing at all in that case. The server refuses a blank
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
        `A turn authored by \`${context.actor}\` names no model (SPEC.md §10). Pass \`--from ` +
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
  /** Defaults to {@link stdinKind}. */
  readonly stdinKind?: StdinKind;
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
 * What fd 0 **is**, as `fstat` sees it — the one question every stdin-reading
 * verb asks, answered in one place with one vocabulary.
 *
 * The five outcomes are not five shades of one boolean. Three of them are
 * decisions and two of them are the same decision for opposite reasons:
 *
 * - `file` — a heredoc (`<<'CORPUS_EOF'`) or `< body.md`. **Read.**
 * - `fifo` — `cmd | corpus`. **Read.**
 * - `tty` — a terminal. **Not read**, because a body-optional verb must not sit
 *   waiting for a human nobody asked.
 * - `other` — `/dev/null`, a closed fd (`0<&-`), any other character device.
 *   **Not read**, and nothing was offered: this is how a caller says "no body".
 * - `socket` — **refused.** See {@link stdinSocketRefusal}.
 *
 * This used to be a boolean, and collapsing `socket` into `false` alongside
 * `other` is exactly what made CLI-066 possible: the CLI could not tell "no body
 * offered" from "a body offered on a transport I will not read", and it resolved
 * the ambiguity by writing a document the caller never wrote.
 */
export type StdinKind = "file" | "fifo" | "tty" | "socket" | "other";

export function stdinKind(fd = 0): StdinKind {
  if (stdinIsTTY()) return "tty";
  let stats;
  try {
    stats = fstatSync(fd);
  } catch {
    // No fd 0 at all (`0<&-`) is exactly "no body on stdin".
    return "other";
  }
  if (stats.isFile()) return "file";
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  return "other";
}

/** The two transports a body may arrive on, and the only two that are ever read. */
export function stdinCarriesABody(kind: StdinKind): boolean {
  return kind === "file" || kind === "fifo";
}

/**
 * The refusal every stdin-reading verb shares when fd 0 is a **socket** — the
 * one transport this CLI can neither read nor safely ignore.
 *
 * **Why it is never read** (CLI-007): `spawn`, `exec` and `spawnSync` hand a
 * child a socketpair on fd 0, and an agent harness leaves one there that is
 * never written to and never closed. Reading it blocks forever, so a verb that
 * read stdin because "it is not a TTY" parked the agent on its first
 * `corpus job log` with nothing on either stream. That decision stands: the
 * refusal below is decided by `fstat` alone, with **zero bytes read and nothing
 * waited on**.
 *
 * **Why it is not silently ignored** (CLI-066): the other socket caller is
 * `spawnSync(…, { input })`, which writes a body and closes. Treating the socket
 * as "no body offered" made the SHARED-070 audit create five documents whose
 * bodies were the type template's empty scaffold, at exit 0, with 340 bytes
 * verifiably written to the pipe and verifiably absent from the document. The
 * loss surfaced days later as an `orphaned_anchor` on a thread quoting text
 * nobody had ever written.
 *
 * The two cases are **indistinguishable without reading**, and reading is the
 * hang. So neither is guessed: the command refuses, exits 2, and sends nothing.
 * A caller that meant to send a body has two transports that work from anywhere
 * (`-m`, `--file`); a caller that meant to send none says so with `< /dev/null`
 * or `stdio: ["ignore", …]`, both of which land in `other` and stay silent.
 *
 * That last sentence is offered **only where sending none is legal**. On
 * `thread reply`, on `job log` and on `doc patch --stdin` it is not — the verb
 * cannot act without the text — and telling that caller to redirect
 * `< /dev/null` would send it one usage error further from the one command that
 * works.
 */
export function stdinSocketRefusal(
  what: string,
  repair: string,
  options: { readonly mayBeOmitted?: boolean } = {},
): UsageError {
  const sayingNone =
    options.mayBeOmitted === false
      ? ""
      : ` If you meant to send no ${what}, say so: redirect \`< /dev/null\`, or spawn with ` +
        `\`stdio: ["ignore", …]\`.`;

  return new UsageError(`stdin is a socket, and a socket is never read — no ${what} was taken.`, {
    hint:
      `A socket on fd 0 is what \`spawn\`, \`exec\` and \`spawnSync({ input })\` give a child, and ` +
      `it is also what an agent harness leaves behind — one that never ends, so reading it would ` +
      `hang this command forever. Those two cannot be told apart without reading, so nothing was ` +
      `sent to the server rather than a ${what} you may have sent being dropped. ${repair}` +
      sayingNone,
  });
}

/** The repair line for the verbs whose stdin carries a document body. */
const BODY_REPAIR =
  'Send it with `-m "…"` or with `--file <path>` — both work from any caller — or on a heredoc ' +
  "or a pipe, which are read.";

/**
 * The paragraph every body-taking verb ends its `--help` with, written once so
 * five verbs cannot describe the same three sources five ways.
 */
export const BODY_SOURCES_HELP =
  '**The body comes from one of three places**, in precedence order: `-m "…"`, `--file <path>`, ' +
  "or a stdin that is a **heredoc** or a **pipe**. A **socket** on stdin is not one of them — " +
  "`spawn`, `exec` and `spawnSync({ input })` all hand a child one, and so does an agent harness, " +
  "whose socket never ends and would hang a read forever. So a run whose stdin is a socket and " +
  "which named no `-m`/`--file` is **refused** (exit 2, nothing sent) instead of being given the " +
  "empty body: a document written without the body you sent is worse than one not written. " +
  "Redirect `< /dev/null` when you mean to send none.";

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
 *
 * A stdin that is a **socket** is neither read nor ignored: it is
 * {@link stdinSocketRefusal}, and only when the caller named no other source —
 * a `-m` or a `--file` already answers the question stdin was being asked, so
 * that caller is never refused and never nagged.
 */
export interface BodySource {
  /** The noun the refusal names: `body`, `reply body`, `first turn`. */
  readonly what?: string;
  /**
   * Whether sending nothing at all is a legal call. False on the verbs that
   * cannot act without the text, so the refusal does not offer `< /dev/null` as
   * a repair that would only produce a second usage error.
   */
  readonly mayBeOmitted?: boolean;
}

export async function resolveBody(
  context: CommandContext,
  dependencies: InputDependencies = {},
  source: BodySource = {},
): Promise<string | undefined> {
  const message = context.flags.string("message");
  if (message !== undefined) return message;

  const file = context.flags.string("file");
  if (file !== undefined) return readBodyFile(context, file, dependencies);

  const kind = dependencies.stdinKind ?? stdinKind();
  if (kind === "socket") {
    throw stdinSocketRefusal(source.what ?? "body", BODY_REPAIR, {
      mayBeOmitted: source.mayBeOmitted ?? true,
    });
  }
  if (!stdinCarriesABody(kind)) return undefined;

  const piped = await readAll(dependencies.stdin ?? stdinStream());
  return piped === "" ? undefined : piped;
}

/** `resolveBody` for the verbs whose body is mandatory — `thread reply`. */
export async function requireBody(
  context: CommandContext,
  what: string,
  dependencies: InputDependencies = {},
): Promise<string> {
  const body = await resolveBody(context, dependencies, { what, mayBeOmitted: false });
  if (body === undefined || body === "") {
    throw new UsageError(`no ${what} to send.`, {
      hint: `Pass it with -m "…", with --file <path>, or pipe it in: \`… <<'CORPUS_EOF' … CORPUS_EOF\`. Always \`CORPUS_EOF\`, never \`EOF\`: text you are carrying can contain a line reading \`EOF\`, which ends the heredoc early and runs the rest as commands.`,
    });
  }
  return body;
}

function readBodyFile(
  context: CommandContext,
  file: string,
  dependencies: InputDependencies,
): Promise<string> {
  return readFlagFile(context, "file", file, dependencies);
}

/**
 * The text a `--<something>-file` flag names, read verbatim and relative to the
 * directory the command was invoked from.
 *
 * It lives here rather than in the verb that wants it because **the `doc` and
 * `thread` modules may not import `node:fs` at all** (`commands/hygiene.test.ts`,
 * CLAUDE.md Architecture Decision 2). That rule is about the CLI never *writing*
 * workspace data, and it is enforced by forbidding the module outright, with no
 * per-file exemptions — so the one legitimate read those verbs need is performed
 * from this module, which every body-taking verb already goes through. Reading is
 * the only filesystem access the CLI has, and every byte read here goes straight
 * to the server.
 *
 * The failure is a **usage error**: a path that does not resolve is a malformed
 * invocation, and the cause's own message (`ENOENT`, `EISDIR`) is the hint,
 * because nothing this layer could add would be more specific.
 */
export async function readFlagFile(
  context: CommandContext,
  flag: string,
  file: string,
  dependencies: InputDependencies,
): Promise<string> {
  const path = isAbsolute(file) ? file : resolve(context.cwd, file);
  const read = dependencies.readTextFile ?? ((target: string) => readFile(target, "utf8"));
  try {
    return await read(path);
  } catch (cause) {
    throw new UsageError(`cannot read --${flag} ${file}.`, {
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
 * §11's warnings, folded onto the verb's single success line. Details are
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
