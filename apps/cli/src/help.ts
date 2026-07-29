import { argUsage } from "./parse-args.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import type { CommandSpec, FlagSpec, Registry, TopicSpec } from "./registry/types.js";

/**
 * Every `--help` byte is rendered from the registry (SPEC.md §2.3). Nothing here
 * knows the name of a command, a flag or an argument: it only knows how to lay
 * out whatever the registry declares.
 */

export interface HelpOptions {
  readonly color: boolean;
}

const noStyle = (text: string): string => text;

function styler(options: HelpOptions): (text: string) => string {
  return options.color ? (text) => `\u001b[1m${text}\u001b[0m` : noStyle;
}

export function flagUsage(flag: FlagSpec): string {
  const alias = flag.alias === undefined ? "" : `-${flag.alias}, `;
  const value = flag.type === "boolean" ? "" : ` <${flag.valueName ?? flag.type}>`;
  return `${alias}--${flag.name}${value}`;
}

export function flagDescription(flag: FlagSpec): string {
  const parts = [flag.description];
  if (flag.default !== undefined) parts.push(`(default: ${String(flag.default)})`);
  if (flag.repeated === true) parts.push("(repeatable)");
  return parts.join(" ");
}

export function commandSynopsis(command: CommandSpec, topic?: string): string {
  const path = topic === undefined ? command.name : `${topic} ${command.name}`;
  return ["corpus", path, ...command.args.map(argUsage), "[flags]"].join(" ");
}

export function renderRootHelp(registry: Registry, options: HelpOptions): string {
  const bold = styler(options);
  const sections: string[] = [`corpus — ${registry.summary}`, ""];

  sections.push(bold("Usage:"));
  sections.push("  corpus <command> [args] [flags]");
  sections.push("  corpus <topic> <verb> [args] [flags]");

  if (registry.commands.length > 0) {
    sections.push("", bold("Commands:"));
    sections.push(...list(registry.commands.map((c) => [c.name, c.summary] as const)));
  }
  if (registry.topics.length > 0) {
    sections.push("", bold("Topics:"));
    sections.push(...list(registry.topics.map((t) => [t.name, t.summary] as const)));
  }

  sections.push("", bold("Global flags:"), ...globalFlagLines());
  sections.push(
    "",
    "Run `corpus <command> --help` or `corpus <topic> --help` for details.",
    "Full command reference: docs/cli.md in the corpus repository.",
  );
  return `${sections.join("\n")}\n`;
}

export function renderTopicHelp(topic: TopicSpec, options: HelpOptions): string {
  const bold = styler(options);
  const sections: string[] = [`corpus ${topic.name} — ${topic.summary}`];
  if (topic.description !== undefined) sections.push("", topic.description);

  sections.push("", bold("Usage:"), `  corpus ${topic.name} <verb> [args] [flags]`);
  sections.push("", bold("Verbs:"));
  sections.push(...list(topic.commands.map((c) => [c.name, c.summary] as const)));
  sections.push("", bold("Global flags:"), ...globalFlagLines());
  sections.push("", `Run \`corpus ${topic.name} <verb> --help\` for a verb's arguments.`);
  return `${sections.join("\n")}\n`;
}

export function renderCommandHelp(
  command: CommandSpec,
  options: HelpOptions & { readonly topic?: string },
): string {
  const bold = styler(options);
  const path = options.topic === undefined ? command.name : `${options.topic} ${command.name}`;
  const sections: string[] = [`corpus ${path} — ${command.summary}`];
  if (command.description !== undefined) sections.push("", command.description);

  sections.push("", bold("Usage:"), `  ${commandSynopsis(command, options.topic)}`);

  if (command.args.length > 0) {
    sections.push("", bold("Arguments:"));
    sections.push(...list(command.args.map((arg) => [argUsage(arg), arg.description] as const)));
  }
  if (command.flags.length > 0) {
    sections.push("", bold("Flags:"));
    sections.push(...list(command.flags.map((f) => [flagUsage(f), flagDescription(f)] as const)));
  }

  sections.push("", bold("Global flags:"), ...globalFlagLines());
  sections.push("", bold("Examples:"));
  for (const example of command.examples) {
    sections.push(`  # ${example.description}`, `  ${example.command}`);
  }
  return `${sections.join("\n")}\n`;
}

function globalFlagLines(): readonly string[] {
  return list(GLOBAL_FLAGS.map((flag) => [flagUsage(flag), flagDescription(flag)] as const));
}

/** Two-column layout with the left column padded to a common width. */
function list(rows: readonly (readonly [string, string])[]): readonly string[] {
  const width = rows.reduce((max, [left]) => Math.max(max, left.length), 0);
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}
