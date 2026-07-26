import type { CliClient } from "../client.js";
import type { Output } from "../output.js";
import type { ParsedArgs, ParsedFlags } from "../parse-args.js";
import type { Workspace } from "../workspace.js";

/**
 * The command surface is data (SPEC.md §2.3). One registry drives the
 * dispatcher, every level of `--help`, and the generated `docs/cli.md`, so help,
 * docs and behaviour cannot disagree — they have exactly one source.
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
  readonly description: string;
}

export interface ArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

export interface Example {
  /** A runnable command line, e.g. "corpus health --json". */
  readonly command: string;
  readonly description: string;
}

export interface CommandContext {
  readonly args: ParsedArgs;
  readonly flags: ParsedFlags;
  readonly out: Output;
}

export interface WorkspaceCommandContext extends CommandContext {
  readonly workspace: Workspace;
  readonly client: CliClient;
}

interface CommandSpecBase {
  /** The verb, e.g. `health` or `start`. */
  readonly name: string;
  /** One line, shown in every listing. */
  readonly summary: string;
  /** Paragraph shown by `--help` and in `docs/cli.md`. */
  readonly description?: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  /** At least one — enforced by registry validation, which is what keeps docs useful. */
  readonly examples: readonly Example[];
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
