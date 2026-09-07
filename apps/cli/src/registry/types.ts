import type { Actor } from "@corpus/contract";
import type { CliClient } from "../client.js";
import type { Output } from "../output.js";
import type { ParsedArgs, ParsedFlags } from "../parse-args.js";
import type { Workspace } from "../workspace.js";

/**
 * The command surface is data (SPEC.md §2.3). One registry drives the
 * dispatcher, every level of `--help`, and the generated `docs/cli.md`, so help,
 * docs and behaviour cannot disagree — they have exactly one source.
 *
 * Every shape a command declares about itself lives here, and nowhere else:
 * flags, args, examples, the two contexts a handler may be given, and the
 * registry itself. One declaration, in the module the registry validates.
 */

export type FlagType = "boolean" | "string" | "number";

export interface FlagSpec {
  /** Long name without the leading dashes, kebab-case: `no-color`. */
  readonly name: string;
  /** Optional single-character alias, used as `-h`. */
  readonly alias?: string;
  readonly type: FlagType;
  /** Repeatable flags collect every occurrence instead of last-one-wins. */
  readonly repeated?: boolean;
  /** Applied when the flag is absent. Booleans default to `false` regardless. */
  readonly default?: boolean | string | number;
  /** Placeholder shown in help for value-taking flags: `--workspace <path>`. */
  readonly valueName?: string;
  /**
   * A string flag whose value may be left off: `--help` and `--help=brief` are
   * both legal, and the bare form means this value.
   *
   * Such a flag never takes its value from the **following** token, only from
   * the inline `--flag=value` form. That is the whole point: `corpus doc list
   * --help` must not swallow a positional, and `corpus --help` must not swallow
   * the command name (CLI-056).
   */
  readonly bareValue?: string;
  /**
   * This flag's value is a **document or thread id**, so an invocation that
   * carries it names that document (SPEC.md §9.4). See {@link ArgSpec.subject}.
   */
  readonly subject?: true;
  /**
   * This flag names a **file whose contents the invocation carries** — so those
   * bytes are part of what the caller wrote (SPEC.md §9.4), and the cost report
   * counts them exactly as it counts the same text typed into the argv or piped
   * on stdin.
   *
   * **The rule the marker states: a body costs what a body costs, whatever
   * carried it.** `wroteBytes` was argv plus stdin only, so the identical
   * 2100-byte reply measured 182 bytes through `--flag-file` and 2143 through a
   * heredoc — the same write, twelve times apart (PHASE-59 evaluation, FAIL-1).
   * That is not a bookkeeping detail: `--flag-file` is the CLI's injection-safe
   * route and `corpus --help` sends the largest payloads down it, so the safest
   * way to write was the least measured one, and an agent could halve a
   * document's recorded cost by changing transport alone.
   *
   * **What earns the marker.** A flag whose *content* becomes a value of the
   * request — `--file` (the body), `--old-file` and `--new-file` (a patch's two
   * sides), and `--flag-file`, which substitutes for the argv itself and so
   * counts whatever flag it fills. A flag whose path merely *names a target* —
   * `--workspace <path>`, `--folder <path>` — reads nothing into the
   * invocation and carries no marker: its argv bytes are its whole cost, as
   * before.
   *
   * **Only on a string flag**, and `validateRegistry` refuses a `--…-file` flag
   * that does not declare it — a file-reading flag added without the marker is
   * silently uncounted, which is exactly how FAIL-1 happened.
   */
  readonly payload?: true;
  readonly description: string;
}

export interface Example {
  /** A runnable command line, e.g. "corpus health --json". */
  readonly command: string;
  readonly description: string;
}

/**
 * One positional argument. The **last** one may be variadic and absorb every
 * remaining token, which is what `corpus doc check <id>…` needs (SPEC.md §11);
 * `validateRegistry` refuses the flag anywhere else, because a positional
 * declared after a variadic one could never be bound.
 */
export interface ArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
  readonly variadic?: true;
  /**
   * This argument's value is a **document or thread id** (SPEC.md §9.4).
   *
   * The cost report attributes an invocation to the documents it **named in its
   * own parsed input**, and this marker is how it knows which values those are.
   * Declaring it here rather than deriving it makes "which ids does this verb
   * name" a property of the command surface: a new id-taking argument is
   * attributed by declaring one word, and a verb whose id arrives in a flag is
   * covered by the same word on the flag.
   *
   * Three rules, because each of them is a mistake somebody will otherwise make:
   *
   * - **Only ids the caller typed.** An id read back out of a *response* is
   *   never a subject. `corpus search` and `corpus doc list` name no document
   *   and report none, because attributing a listing's cost to the documents it
   *   returned would measure a different thing than §9.4 defines.
   * - **Only `doc_*` and `th_*`.** A queue event id (`--job`, `event-id`), a
   *   folder path, a commit sha, a skill name and a version key are not
   *   documents, however id-shaped they look.
   * - **Threads are documents.** A `th_*` argument carries this marker exactly
   *   like a `doc_*` one.
   */
  readonly subject?: true;
}

/**
 * Everything a handler is allowed to know about the process it runs in. Ambient
 * state is read once, in `run.ts`, and handed down — a handler that reached for
 * `process.cwd()` or `process.env` itself would be untestable without a chdir.
 */
export interface CommandContext {
  readonly args: ParsedArgs;
  readonly flags: ParsedFlags;
  readonly out: Output;
  /** Directory the command was invoked from; relative paths resolve against it. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Version of the `corpus` tool, for anything that records its provenance. */
  readonly version: string;
  /**
   * The command surface this build has — the same declaration that rendered the
   * help the caller read.
   *
   * Here so that a verb can answer "does this tool have `corpus skill
   * rollback`?" without importing `registry/index.ts`: a command module that
   * imported the registry that imports it would close a cycle. The one caller
   * today is the upgrade's stale-citation scan (CLI-059), which needs the
   * installed surface to judge a workspace's skills against.
   */
  readonly registry: Registry;
  /**
   * Where a **composite** verb records one measurement per command it ran
   * (SPEC.md §9.4), instead of the single measurement the dispatcher would
   * otherwise report for the whole invocation.
   *
   * `corpus batch` is the only caller and is why this exists: a batch of three
   * entries is three invocations wearing one process, and one report over the
   * lot would attribute every entry's cost to every entry's document. Recording
   * even once replaces the invocation's own report with the recorded ones — see
   * {@link CostLedger}.
   *
   * Optional because a handler may be invoked outside the dispatcher (a batch
   * entry runs one), and a verb that does not compose has no use for it.
   */
  readonly costs?: CostLedger;
}

/**
 * One measured sub-invocation, as a composite verb reports it.
 *
 * Bytes, never tokens: the CLI counts and the server converts, in one place
 * (`estimateTokens`, sprint-025 R1).
 */
export interface SubInvocationCost {
  /** The entry's own resolved command path — `doc show`, `thread reply`. */
  readonly command: string;
  readonly wroteBytes: number;
  readonly readBytes: number;
  /** The documents and threads this entry named in its own argv. */
  readonly subjects: readonly string[];
}

/**
 * The dispatcher's collector for {@link CommandContext.costs}.
 *
 * **Recording is a replacement, not an addition.** A composite verb that
 * records its entries suppresses the invocation-level report entirely, because
 * the process's own printed bytes include every entry's output plus the
 * composite's framing — reporting both would count the same bytes twice and
 * attribute the sum to every subject in it. A composite that records nothing
 * (a batch refused before anything ran) is reported as the ordinary single
 * invocation it turned out to be.
 */
export interface CostLedger {
  record(cost: SubInvocationCost): void;
}

export interface WorkspaceCommandContext extends CommandContext {
  readonly workspace: Workspace;
  readonly client: CliClient;
  /**
   * The acting party the client sends on every request, resolved once by the
   * dispatcher (`--from` ?? `CORPUS_FROM` ?? `user`). Handlers read it only to
   * *refuse* — `doc delete` is user-only and rejects the agent before any
   * request — never to re-derive what the client already sends.
   */
  readonly actor: Actor;
}

/**
 * Everything a command declares about itself, handler aside — the one member
 * whose context differs per command kind.
 */
interface CommandSpecBase {
  /** The verb, e.g. `add`. Invoked as `corpus <topic> <verb>`, or `corpus <verb>`. */
  readonly name: string;
  /** One line, shown in every listing. */
  readonly summary: string;
  /** Paragraph shown by `--help` and in `docs/cli.md`. */
  readonly description?: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  /** At least one — enforced by registry validation, which is what keeps docs useful. */
  readonly examples: readonly Example[];
  /**
   * Declared `false` by the commands whose cost is **not** reported (SPEC.md
   * §9.4, CLI-085). Everything else is measured, which is why the marker is only
   * ever written as an exclusion.
   *
   * The exclusions are here, on the command, rather than in a name list inside
   * the reporter: a dispatcher holding a list of command names would be a second
   * declaration of the command surface, and it is the thing that goes stale when
   * a verb is renamed. `validateRegistry` checks the one rule that is
   * structural — a command that runs without a workspace has no server to report
   * to, so it may not be measured — and the generated reference renders the
   * exclusion, so a reader can see which verbs are absent from the ledger.
   *
   * Two kinds of command carry it:
   *
   * - **`corpus init` and `corpus upgrade`** run with no workspace at all
   *   (`requiresWorkspace: false`), so there is no base URL and no token to
   *   report with.
   * - **The `corpus server` lifecycle verbs** run when the server is down by
   *   definition. `server stop` would pay the report's timeout against the
   *   server it has just killed, and `server start` would record the invocation
   *   that made reporting possible in the first place.
   *
   * `--help` and `--version` need no marker: they return before a report is
   * composed at all, whichever command they were asked of.
   *
   * `requiresWorkspace: false` does **not** express this set on its own — the
   * server lifecycle verbs do resolve a workspace — which is why this is a field
   * of its own rather than a reading of that one.
   */
  readonly measured?: false;
}

/** The normal case: the dispatcher resolves the workspace and builds the client first. */
export interface WorkspaceCommandSpec extends CommandSpecBase {
  readonly requiresWorkspace?: true;
  readonly handler: (context: WorkspaceCommandContext) => Promise<void>;
}

/** `corpus init` and friends: must run with no workspace and no server. */
export interface StandaloneCommandSpec extends CommandSpecBase {
  readonly requiresWorkspace: false;
  readonly handler: (context: CommandContext) => Promise<void>;
}

export type CommandSpec = WorkspaceCommandSpec | StandaloneCommandSpec;

/** A group of verbs invoked as `corpus <topic> <verb>`. */
export interface TopicSpec {
  readonly name: string;
  readonly summary: string;
  readonly description?: string;
  readonly commands: readonly CommandSpec[];
}

/**
 * `commands` are invoked directly (`corpus health`); `topics` group verbs
 * (`corpus server start`).
 */
export interface Registry {
  /** One-line description of the tool, shown by `corpus --help` and in `docs/cli.md`. */
  readonly summary: string;
  readonly commands: readonly CommandSpec[];
  readonly topics: readonly TopicSpec[];
}
