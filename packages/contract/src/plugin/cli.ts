import type { Actor } from "../actor.js";

/**
 * The CLI half of the plugin type contract (SPEC.md §10, §2.3): what a plugin's
 * `cli/commands/*.ts` module default-exports, and what its handler is handed.
 *
 * These are **plugin-facing interfaces, not the CLI's internals** (CONTRACT-015,
 * sprint-013 Adjudication 16). The declarative half — args, flags, examples — is
 * the CLI's own data shape, graduated verbatim and aliased back by
 * `apps/cli/src/registry/types.ts`, so the registry validates plugin verbs with
 * exactly the rules it validates core verbs with. The *context* half is narrowed
 * on purpose:
 *
 * - the CLI's `ParsedArgs`/`ParsedFlags` are classes with `#private` fields, so
 *   they are nominally typed and no published type could ever be satisfied by
 *   them — they appear here as the plain-object **views** of what they answer;
 * - its `Workspace` comes from a module that reads `node:fs`, so only the two
 *   fields a verb needs to reach its own server routes are published;
 * - its `CliClient` is bound to `@corpus/contract/client`, the one subpath
 *   plugins are lint-forbidden to import (a plugin that constructs its own
 *   transport bypasses the kit's cache and invalidation), so the client arrives
 *   as the capability handle below rather than as the generated API surface.
 *
 * `apps/cli`'s concrete `WorkspaceCommandContext` satisfies
 * {@link PluginCommandContext} structurally — asserted at compile time in
 * `apps/cli/src/registry/types.ts` — so the dispatcher hands a plugin handler
 * its real context with no adapter object in between, and the day the CLI
 * narrows that context the assertion fails to compile.
 */

export type PluginFlagType = "boolean" | "string" | "number";

export interface PluginFlagSpec {
  /** Long name without the leading dashes, kebab-case: `no-color`. */
  readonly name: string;
  /** Optional single-character alias, used as `-h`. */
  readonly alias?: string;
  readonly type: PluginFlagType;
  /** Repeatable flags collect every occurrence instead of last-one-wins. */
  readonly repeated?: boolean;
  /** Applied when the flag is absent. Booleans default to `false` regardless. */
  readonly default?: boolean | string | number;
  /** Placeholder shown in help for value-taking flags: `--workspace <path>`. */
  readonly valueName?: string;
  readonly description: string;
}

export interface PluginArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

export interface PluginExample {
  /** A runnable command line, e.g. "corpus health --json". */
  readonly command: string;
  readonly description: string;
}

/** The positional arguments the CLI parsed, as the command declared them. */
export interface PluginCommandArgs {
  /** A required positional; absence is a spec bug, not user input, and throws. */
  get(name: string): string;
  /** An optional positional: `undefined` when it was not given. */
  optional(name: string): string | undefined;
}

/** The flags the CLI parsed, read by declared type — defaults already applied. */
export interface PluginCommandFlags {
  boolean(name: string): boolean;
  string(name: string): string | undefined;
  number(name: string): number | undefined;
  /** Every occurrence of a `repeated` flag, in order. */
  strings(name: string): readonly string[];
}

/**
 * The two ways a verb writes (SPEC.md §2.3). `emit` is the command's single
 * machine-readable result, written only under `--json` and only once; `line` is
 * a human one-liner, suppressed under `--json` so stdout stays exactly one JSON
 * value. A verb calls both unconditionally and stays branch-free.
 */
export interface PluginCommandOutput {
  emit(value: unknown): void;
  line(text: string): void;
}

/** The two facts a plugin verb needs to reach its own `/api/x/<plugin>` routes. */
export interface PluginCommandWorkspace {
  /** Origin the workspace server is bound to, e.g. `http://127.0.0.1:8765`. */
  readonly baseUrl: string;
  /** The workspace bearer token, sent as `Authorization: Bearer <token>`. */
  readonly token: string;
}

/**
 * The transport capability, injected by the dispatcher (sprint-013
 * Adjudication 16). It publishes the server's origin and **not** the generated
 * typed client: `@corpus/contract/client` is lint-forbidden to plugins, and
 * widening this handle means widening what `apps/cli` injects — a CLI change
 * with its own issue, never a shape a plugin declares for itself.
 */
export interface PluginCommandClient {
  /** Origin every request goes to — the same value as `workspace.baseUrl`. */
  readonly baseUrl: string;
}

/** Everything a plugin verb's handler is allowed to know about its process. */
export interface PluginCommandContext {
  readonly args: PluginCommandArgs;
  readonly flags: PluginCommandFlags;
  readonly out: PluginCommandOutput;
  readonly workspace: PluginCommandWorkspace;
  readonly client: PluginCommandClient;
  /**
   * The acting party the CLI attributes this run to (`--from` ?? `CORPUS_FROM`
   * ?? `user`) — the git author of whatever the server commits. A verb sends it
   * as `ACTOR_HEADER`; it never re-derives it.
   */
  readonly actor: Actor;
  /** Directory the command was invoked from; relative paths resolve against it. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Version of the `corpus` tool, for anything that records its provenance. */
  readonly version: string;
}

/**
 * What `plugins/<name>/cli/commands/<verb>.ts` default-exports. The CLI's
 * scanner wraps a plugin's commands into a topic named after its **directory**
 * and merges them before registry validation runs, so a plugin verb with no
 * example fails as loudly as a core verb would — and `--help` and `docs/cli.md`
 * need no plugin knowledge at all.
 *
 * Plugin verbs always run inside a workspace (the dispatcher resolves it and
 * the client before the handler is called), which is why nothing here mirrors
 * the CLI's standalone-command escape hatch.
 */
export interface PluginCommandSpec {
  /** The verb, e.g. `add`. Invoked as `corpus <plugin> <verb>`. */
  readonly name: string;
  /** One line, shown in every listing. */
  readonly summary: string;
  /** Paragraph shown by `--help` and in `docs/cli.md`. */
  readonly description?: string;
  readonly args: readonly PluginArgSpec[];
  readonly flags: readonly PluginFlagSpec[];
  /** At least one — enforced by registry validation, which is what keeps docs useful. */
  readonly examples: readonly PluginExample[];
  readonly handler: (context: PluginCommandContext) => Promise<void>;
}
