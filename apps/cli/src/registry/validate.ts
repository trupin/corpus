import { GLOBAL_FLAG_ALIASES, GLOBAL_FLAG_NAMES } from "./globals.js";
import type { CommandSpec, Registry, TopicSpec } from "./types.js";

/**
 * Structural validation of the command surface. It runs when the registry module
 * loads and inside the docs generator, so a malformed registry fails loudly
 * instead of quietly producing wrong help text and a wrong `docs/cli.md`.
 *
 * The rule that matters most: every command carries at least one example. That
 * is the mechanism that keeps the generated reference worth reading.
 */

export class RegistryValidationError extends Error {
  override readonly name = "RegistryValidationError";
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid command registry:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function collectRegistryProblems(registry: Registry): readonly string[] {
  const problems: string[] = [];

  if (registry.summary.trim() === "") problems.push("the registry has no summary");

  const topLevel = new Set<string>();
  for (const command of registry.commands) {
    if (topLevel.has(command.name)) {
      problems.push(`duplicate top-level name "${command.name}"`);
    }
    topLevel.add(command.name);
    problems.push(...commandProblems(command, `corpus ${command.name}`));
  }
  for (const topic of registry.topics) {
    if (topLevel.has(topic.name)) {
      problems.push(`duplicate top-level name "${topic.name}"`);
    }
    topLevel.add(topic.name);
    problems.push(...topicProblems(topic));
  }

  return problems;
}

export function validateRegistry(registry: Registry): Registry {
  const problems = collectRegistryProblems(registry);
  if (problems.length > 0) throw new RegistryValidationError(problems);
  return registry;
}

function topicProblems(topic: TopicSpec): readonly string[] {
  const problems: string[] = [];
  const label = `corpus ${topic.name}`;

  if (!NAME_PATTERN.test(topic.name)) {
    problems.push(`topic name "${topic.name}" is not kebab-case`);
  }
  if (topic.summary.trim() === "") problems.push(`${label} has no summary`);
  if (topic.commands.length === 0) problems.push(`${label} declares no verbs`);

  const seen = new Set<string>();
  for (const command of topic.commands) {
    if (seen.has(command.name)) {
      problems.push(`${label} declares "${command.name}" twice`);
    }
    seen.add(command.name);
    problems.push(...commandProblems(command, `${label} ${command.name}`));
  }
  return problems;
}

function commandProblems(command: CommandSpec, label: string): readonly string[] {
  const problems: string[] = [];

  if (!NAME_PATTERN.test(command.name)) {
    problems.push(`command name "${command.name}" is not kebab-case`);
  }
  if (command.summary.trim() === "") problems.push(`${label} has no summary`);
  if (command.examples.length === 0) problems.push(`${label} has no examples`);

  command.examples.forEach((example, index) => {
    if (!example.command.startsWith("corpus ")) {
      problems.push(`${label} example ${String(index + 1)} is not a \`corpus …\` command line`);
    }
    if (example.description.trim() === "") {
      problems.push(`${label} example ${String(index + 1)} has no description`);
    }
  });

  let optionalSeen = false;
  const argNames = new Set<string>();
  command.args.forEach((arg, index) => {
    if (argNames.has(arg.name)) problems.push(`${label} declares argument "${arg.name}" twice`);
    argNames.add(arg.name);
    if (!NAME_PATTERN.test(arg.name)) {
      problems.push(`${label} argument "${arg.name}" is not kebab-case`);
    }
    if (arg.description.trim() === "")
      problems.push(`${label} argument "${arg.name}" has no description`);
    if (arg.required && optionalSeen) {
      problems.push(`${label} declares required argument "${arg.name}" after an optional one`);
    }
    // A variadic argument absorbs every remaining token, so anything declared
    // after it could never be bound — a spec the parser cannot honour.
    if (arg.variadic === true && index !== command.args.length - 1) {
      problems.push(`${label} declares variadic argument "${arg.name}" before another argument`);
    }
    if (!arg.required) optionalSeen = true;
  });

  const flagNames = new Set<string>();
  const flagAliases = new Set<string>();
  for (const flag of command.flags) {
    if (GLOBAL_FLAG_NAMES.has(flag.name)) {
      problems.push(`${label} flag "--${flag.name}" shadows a global flag`);
    }
    if (flagNames.has(flag.name)) problems.push(`${label} declares flag "--${flag.name}" twice`);
    flagNames.add(flag.name);

    if (!NAME_PATTERN.test(flag.name))
      problems.push(`${label} flag "--${flag.name}" is not kebab-case`);
    if (flag.description.trim() === "")
      problems.push(`${label} flag "--${flag.name}" has no description`);
    if (flag.type === "boolean" && flag.repeated === true) {
      problems.push(`${label} flag "--${flag.name}" is a repeated boolean, which has no meaning`);
    }
    if (
      flag.type === "boolean" &&
      flag.default !== undefined &&
      typeof flag.default !== "boolean"
    ) {
      problems.push(`${label} flag "--${flag.name}" has a non-boolean default`);
    }
    if (flag.type === "number" && flag.default !== undefined && typeof flag.default !== "number") {
      problems.push(`${label} flag "--${flag.name}" has a non-numeric default`);
    }

    if (flag.alias !== undefined) {
      if (flag.alias.length !== 1) {
        problems.push(
          `${label} flag "--${flag.name}" has a multi-character alias "-${flag.alias}"`,
        );
      }
      if (GLOBAL_FLAG_ALIASES.has(flag.alias)) {
        problems.push(`${label} flag "--${flag.name}" shadows the global alias "-${flag.alias}"`);
      }
      if (flagAliases.has(flag.alias)) {
        problems.push(`${label} reuses the alias "-${flag.alias}"`);
      }
      flagAliases.add(flag.alias);
    }
  }

  return problems;
}
