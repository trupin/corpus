import { UsageError } from "./errors.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import type { CommandSpec, Registry, TopicSpec } from "./registry/types.js";
import { suggest } from "./suggest.js";

/**
 * argv → what to run, resolved from the registry alone (SPEC.md §2.3). The
 * dispatcher knows no command names; it only knows the two shapes the registry
 * can declare: `corpus <command>` and `corpus <topic> <verb>`.
 */

export type Resolution =
  | { readonly kind: "root-help" }
  | { readonly kind: "version" }
  | { readonly kind: "topic-help"; readonly topic: TopicSpec }
  | {
      readonly kind: "command";
      readonly command: CommandSpec;
      readonly topic?: string;
      /** argv with the command-path tokens removed, ready for the flag parser. */
      readonly tokens: readonly string[];
    };

/** Global flags that consume the following token, so a scan does not mistake it for a name. */
const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set(
  GLOBAL_FLAGS.filter((flag) => flag.type !== "boolean").map((flag) => flag.name),
);

const GLOBAL_VALUE_ALIASES: ReadonlySet<string> = new Set(
  GLOBAL_FLAGS.flatMap((flag) =>
    flag.type !== "boolean" && flag.alias !== undefined ? [flag.alias] : [],
  ),
);

export function resolveCommand(registry: Registry, argv: readonly string[]): Resolution {
  const first = findNameToken(argv, 0);

  if (first === undefined) {
    if (hasBooleanFlag(argv, "help")) return { kind: "root-help" };
    return hasBooleanFlag(argv, "version") ? { kind: "version" } : { kind: "root-help" };
  }

  const command = registry.commands.find((candidate) => candidate.name === first.value);
  if (command !== undefined) {
    return { kind: "command", command, tokens: without(argv, [first.index]) };
  }

  const topic = registry.topics.find((candidate) => candidate.name === first.value);
  if (topic === undefined) {
    throw unknownNameError(first.value, topLevelNames(registry));
  }

  const second = findNameToken(argv, first.index + 1);
  if (second === undefined) return { kind: "topic-help", topic };

  const verb = topic.commands.find((candidate) => candidate.name === second.value);
  if (verb === undefined) {
    throw unknownVerbError(
      second.value,
      topic.name,
      topic.commands.map((candidate) => candidate.name),
    );
  }
  return {
    kind: "command",
    command: verb,
    topic: topic.name,
    tokens: without(argv, [first.index, second.index]),
  };
}

export function topLevelNames(registry: Registry): readonly string[] {
  return [
    ...registry.commands.map((command) => command.name),
    ...registry.topics.map((topic) => topic.name),
  ];
}

interface NameToken {
  readonly value: string;
  readonly index: number;
}

/**
 * The first token that is a name rather than a flag or a flag's value. Global
 * value flags may legally precede the command (`corpus --workspace x health`),
 * so the scan has to know which ones swallow the next token.
 */
function findNameToken(argv: readonly string[], from: number): NameToken | undefined {
  for (let index = from; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === "--") return undefined;

    if (!token.startsWith("-") || token === "-") return { value: token, index };
    if (token.includes("=")) continue;

    const isLong = token.startsWith("--");
    const key = isLong ? token.slice(2) : token.slice(1);
    if (isLong ? GLOBAL_VALUE_FLAGS.has(key) : GLOBAL_VALUE_ALIASES.has(key)) index += 1;
  }
  return undefined;
}

function hasBooleanFlag(argv: readonly string[], name: string): boolean {
  return argv.some((token) => token === `--${name}` || token === `--${name}=true`);
}

function without(argv: readonly string[], indices: readonly number[]): readonly string[] {
  const drop = new Set(indices);
  return argv.filter((_token, index) => !drop.has(index));
}

function unknownNameError(name: string, valid: readonly string[]): UsageError {
  return new UsageError(`unknown command "${name}".`, { hint: alternatives(name, valid) });
}

function unknownVerbError(verb: string, topic: string, valid: readonly string[]): UsageError {
  return new UsageError(`unknown verb "${verb}" for "corpus ${topic}".`, {
    hint: alternatives(verb, valid),
  });
}

function alternatives(input: string, valid: readonly string[]): string {
  const known = `Valid: ${valid.join(", ")}. Run \`corpus --help\`.`;
  const suggestion = suggest(input, valid);
  return suggestion === undefined ? known : `Did you mean "${suggestion}"? ${known}`;
}
