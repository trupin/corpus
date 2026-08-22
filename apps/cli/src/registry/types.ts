import type { Actor } from "@corpus/contract";
import type {
  PluginArgSpec,
  PluginCommandContext,
  PluginCommandSpec,
  PluginExample,
  PluginFlagSpec,
  PluginFlagType,
} from "@corpus/contract/plugin";
import type { CliClient } from "../client.js";
import type { Output } from "../output.js";
import type { ParsedArgs, ParsedFlags } from "../parse-args.js";
import type { Workspace } from "../workspace.js";

/**
 * The command surface is data (SPEC.md §2.3). One registry drives the
 * dispatcher, every level of `--help`, and the generated `docs/cli.md`, so help,
 * docs and behaviour cannot disagree — they have exactly one source.
 *
 * The *declarative* half of that data — flags, args, examples, and every field
 * of a command but its handler — is declared once in `@corpus/contract/plugin`
 * and aliased here (CONTRACT-015). A plugin's `cli/commands/*.ts` may import
 * only `@corpus/kit` and `@corpus/contract`, and its verbs go through this
 * registry unchanged, so a second declaration of these shapes would be a fork
 * of the surface the registry validates. What stays local is what a plugin
 * never declares: the CLI's own rich contexts, the standalone-command escape
 * hatch (`corpus init`), topics (derived from a plugin's directory name by the
 * scanner) and the registry itself.
 */

export type FlagType = PluginFlagType;
export type FlagSpec = PluginFlagSpec;
export type Example = PluginExample;

/**
 * The published positional shape plus one core-only refinement: the **last**
 * argument may be variadic and absorb every remaining token, which is what
 * `corpus doc check <id>…` needs (SPEC.md §11). It is deliberately not in
 * `@corpus/contract/plugin`: a plugin declares fixed positionals, and widening
 * the published shape for one core verb would put a field on the plugin surface
 * that nothing there uses. The widening is safe in the direction that matters —
 * a `PluginArgSpec` already satisfies this interface, so a plugin's spec still
 * enters the registry unchanged.
 */
export interface ArgSpec extends PluginArgSpec {
  readonly variadic?: true;
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
 * Everything a command declares about itself, handler aside — the published
 * plugin shape minus the one member whose context differs per command kind.
 */
interface CommandSpecBase extends Omit<PluginCommandSpec, "handler" | "args"> {
  readonly args: readonly ArgSpec[];
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
 * (`corpus server start`). Plugin-contributed verbs register through the same
 * shapes, so nothing may assume a closed set.
 */
export interface Registry {
  /** One-line description of the tool, shown by `corpus --help` and in `docs/cli.md`. */
  readonly summary: string;
  readonly commands: readonly CommandSpec[];
  readonly topics: readonly TopicSpec[];
}

/**
 * The two compile-time adapter checks that make the published plugin surface
 * honest (CONTRACT-015, sprint-013 Adjudication 16). The CLI's internals are
 * *not* published — `ParsedArgs`/`ParsedFlags` are classes with `#private`
 * fields, `Workspace` comes from a module that reads `node:fs`, and `CliClient`
 * is bound to `@corpus/contract/client` — so the contract publishes narrowed
 * structural views instead, and these assertions are what keep the two in step:
 * no adapter object exists at runtime because none is needed, and the day
 * either side drifts, `apps/cli` stops compiling.
 */
type AssertAssignable<Expected, Actual extends Expected> = Actual;

/** The dispatcher hands a plugin verb this exact object (`run.ts`). */
type _WorkspaceContextIsAPluginContext = AssertAssignable<
  PluginCommandContext,
  WorkspaceCommandContext
>;

/** A plugin's default-exported spec enters the registry as an ordinary verb. */
type _PluginSpecIsACommandSpec = AssertAssignable<CommandSpec, PluginCommandSpec>;
