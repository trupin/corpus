import { createOutput } from "../output.js";
import { ParsedArgs, ParsedFlags, type ArgValue, type FlagValue } from "../parse-args.js";
import type {
  CommandContext,
  CommandSpec,
  Registry,
  TopicSpec,
  WorkspaceCommandSpec,
} from "./types.js";

/**
 * A small registry used by the parser, dispatcher, help and docs tests. Keeping
 * the tests off the real registry means adding a real command never breaks a
 * snapshot, while still exercising every shape the registry can express:
 * top-level commands, topics with verbs, every flag type, and optional args.
 */

export const noopHandler = async (): Promise<void> => {
  await Promise.resolve();
};

export const fixtureEverythingCommand: WorkspaceCommandSpec = {
  name: "everything",
  summary: "Exercise every declarable flag and argument shape.",
  description: "Used by the parser and help tests; never registered in the real registry.",
  args: [
    { name: "target", required: true, description: "The thing to act on." },
    { name: "note", required: false, description: "An optional note." },
  ],
  flags: [
    { name: "loud", alias: "l", type: "boolean", description: "A boolean flag." },
    { name: "title", type: "string", valueName: "text", description: "A string flag." },
    { name: "count", type: "number", default: 3, description: "A number flag with a default." },
    { name: "tag", type: "string", repeated: true, description: "A repeatable string flag." },
  ],
  examples: [{ command: "corpus everything doc-1 --loud", description: "Act loudly on doc-1." }],
  handler: noopHandler,
};

export const fixtureStandaloneCommand: CommandSpec = {
  name: "bootstrap",
  summary: "Run without a workspace or a server.",
  requiresWorkspace: false,
  args: [],
  flags: [],
  examples: [{ command: "corpus bootstrap", description: "Bootstrap in the current directory." }],
  handler: noopHandler,
};

export const fixtureTopic: TopicSpec = {
  name: "widget",
  summary: "Manage widgets.",
  description: "A fixture topic standing in for `server`, `doc` and friends.",
  commands: [
    {
      name: "list",
      summary: "List widgets.",
      args: [],
      flags: [{ name: "limit", type: "number", description: "How many widgets to list." }],
      examples: [{ command: "corpus widget list", description: "List every widget." }],
      handler: noopHandler,
    },
    {
      name: "show",
      summary: "Show one widget.",
      args: [{ name: "id", required: true, description: "The widget id." }],
      flags: [],
      examples: [{ command: "corpus widget show w-1", description: "Show widget w-1." }],
      handler: noopHandler,
    },
  ],
};

export const fixtureRegistry: Registry = {
  summary: "a fixture surface used only by tests.",
  commands: [fixtureEverythingCommand, fixtureStandaloneCommand],
  topics: [fixtureTopic],
};

export interface TestContextOptions {
  readonly args?: Readonly<Record<string, ArgValue>>;
  readonly flags?: Readonly<Record<string, FlagValue>>;
  readonly json?: boolean;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly version?: string;
}

export interface TestContext {
  readonly context: CommandContext;
  /** Everything written to stdout so far, joined. */
  stdout(): string;
  stderr(): string;
}

/**
 * A `CommandContext` for calling a handler directly. Handlers take every ambient
 * input as a parameter precisely so that this is possible without a chdir, a
 * spawned process, or a mocked `node:process`.
 */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    context: {
      args: new ParsedArgs(new Map(Object.entries(options.args ?? {}))),
      flags: new ParsedFlags(new Map(Object.entries(options.flags ?? {}))),
      out: createOutput({
        json: options.json ?? false,
        color: false,
        stdout: (text) => void stdout.push(text),
        stderr: (text) => void stderr.push(text),
      }),
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? {},
      version: options.version ?? "0.0.0-test",
    },
  };
}
