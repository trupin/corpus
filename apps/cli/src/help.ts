import { UsageError } from "./errors.js";
import { gloss } from "./gloss.js";
import { argUsage } from "./parse-args.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import type { ArgSpec, CommandSpec, FlagSpec, Registry, TopicSpec } from "./registry/types.js";

/**
 * Every `--help` byte is rendered from the registry (SPEC.md §2.3). Nothing here
 * knows the name of a command, a flag or an argument: it only knows how to lay
 * out whatever the registry declares.
 *
 * Two registers, one source (CLI-056). `full` is the default and is unchanged —
 * the prose is precise and is why the commands are usable. `brief` prints the
 * synopsis and one line per argument and flag, and nothing else, for the reader
 * who is recalling a name rather than learning a command. The brief line is the
 * *first sentence* of the full description (`gloss.ts`), never a second field,
 * so no amount of editing can make the two disagree.
 */

export type HelpMode = "full" | "brief";

/** Every mode `--help=<mode>` accepts, in the order the usage hint lists them. */
export const HELP_MODES: readonly HelpMode[] = ["full", "brief"];

/** What bare `--help` means. Declared as the `help` flag's `bareValue` too. */
export const DEFAULT_HELP_MODE: HelpMode = "full";

export interface HelpOptions {
  readonly color: boolean;
  /** Omitted is {@link DEFAULT_HELP_MODE}: full help is the default and stays it. */
  readonly mode?: HelpMode;
}

/**
 * The value of `--help`, as a mode. An unrecognised one is a usage error rather
 * than a silent fall back to full help: a caller who typed `--help=short` asked
 * for something and must be told the tool has no such register, not handed six
 * thousand words instead.
 */
export function parseHelpMode(raw: string | undefined): HelpMode {
  if (raw === undefined) return DEFAULT_HELP_MODE;
  const mode = HELP_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) {
    throw new UsageError(`unknown help mode "${raw}".`, {
      hint:
        "Usage: `--help` for the full text, `--help=brief` for names and one line each. " +
        `Modes: ${HELP_MODES.join(", ")}.`,
    });
  }
  return mode;
}

const noStyle = (text: string): string => text;

function styler(options: HelpOptions): (text: string) => string {
  return options.color ? (text) => `\u001b[1m${text}\u001b[0m` : noStyle;
}

export function flagUsage(flag: FlagSpec): string {
  const alias = flag.alias === undefined ? "" : `-${flag.alias}, `;
  const placeholder = `<${flag.valueName ?? flag.type}>`;
  // `--help[=<mode>]` rather than `--help <mode>`: the bracket form is the one
  // that works, since such a flag never reads the following token.
  const value =
    flag.type === "boolean"
      ? ""
      : flag.bareValue === undefined
        ? ` ${placeholder}`
        : `[=${placeholder}]`;
  return `${alias}--${flag.name}${value}`;
}

export function flagDescription(flag: FlagSpec, mode: HelpMode = DEFAULT_HELP_MODE): string {
  // The default and the repeatability are one word each and change what a
  // caller has to type, so brief keeps them: they are not prose.
  const parts = [mode === "brief" ? gloss(flag.description) : flag.description];
  if (flag.default !== undefined) parts.push(`(default: ${String(flag.default)})`);
  if (flag.repeated === true) parts.push("(repeatable)");
  return parts.join(" ");
}

export function argDescription(arg: ArgSpec, mode: HelpMode = DEFAULT_HELP_MODE): string {
  return mode === "brief" ? gloss(arg.description) : arg.description;
}

export function commandSynopsis(command: CommandSpec, topic?: string): string {
  const path = topic === undefined ? command.name : `${topic} ${command.name}`;
  return ["corpus", path, ...command.args.map(argUsage), "[flags]"].join(" ");
}

export function renderRootHelp(registry: Registry, options: HelpOptions): string {
  const bold = styler(options);
  const brief = isBrief(options);
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

  if (brief) {
    sections.push("", "Run `corpus --help` for the full text.");
    return `${sections.join("\n")}\n`;
  }

  sections.push("", bold("Global flags:"), ...globalFlagLines(options));
  sections.push(
    "",
    "Run `corpus <command> --help` or `corpus <topic> --help` for details.",
    "Add `=brief` to any of them for names and one line each.",
    "Full command reference: docs/cli.md in the corpus repository.",
  );
  return `${sections.join("\n")}\n`;
}

export function renderTopicHelp(topic: TopicSpec, options: HelpOptions): string {
  const bold = styler(options);
  const brief = isBrief(options);
  const sections: string[] = [`corpus ${topic.name} — ${topic.summary}`];
  // The topic paragraph is the register brief exists to skip: a verb list is
  // already one line each.
  if (!brief && topic.description !== undefined) sections.push("", topic.description);

  sections.push("", bold("Usage:"), `  corpus ${topic.name} <verb> [args] [flags]`);
  sections.push("", bold("Verbs:"));
  sections.push(...list(topic.commands.map((c) => [c.name, c.summary] as const)));

  if (brief) {
    sections.push("", `Run \`corpus ${topic.name} --help\` for the full text.`);
    return `${sections.join("\n")}\n`;
  }

  sections.push("", bold("Global flags:"), ...globalFlagLines(options));
  sections.push("", `Run \`corpus ${topic.name} <verb> --help\` for a verb's arguments.`);
  return `${sections.join("\n")}\n`;
}

export function renderCommandHelp(
  command: CommandSpec,
  options: HelpOptions & { readonly topic?: string },
): string {
  const bold = styler(options);
  const brief = isBrief(options);
  const mode = options.mode ?? DEFAULT_HELP_MODE;
  const path = options.topic === undefined ? command.name : `${options.topic} ${command.name}`;
  const sections: string[] = [`corpus ${path} — ${command.summary}`];
  if (!brief && command.description !== undefined) sections.push("", command.description);

  sections.push("", bold("Usage:"), `  ${commandSynopsis(command, options.topic)}`);

  if (command.args.length > 0) {
    sections.push("", bold("Arguments:"));
    sections.push(
      ...list(command.args.map((arg) => [argUsage(arg), argDescription(arg, mode)] as const)),
    );
  }
  if (command.flags.length > 0) {
    sections.push("", bold("Flags:"));
    sections.push(
      ...list(command.flags.map((f) => [flagUsage(f), flagDescription(f, mode)] as const)),
    );
  }

  // Global flags stay in brief. A caller asking "does this verb take `--json`?"
  // is asking exactly the question brief is for, and sending them to the full
  // text for the answer would undo the saving on the next invocation.
  sections.push("", bold("Global flags:"), ...globalFlagLines(options));

  if (brief) {
    sections.push("", `Run \`corpus ${path} --help\` for the full text and examples.`);
    return `${sections.join("\n")}\n`;
  }

  sections.push("", bold("Examples:"));
  for (const example of command.examples) {
    sections.push(`  # ${example.description}`, `  ${example.command}`);
  }
  return `${sections.join("\n")}\n`;
}

function isBrief(options: HelpOptions): boolean {
  return (options.mode ?? DEFAULT_HELP_MODE) === "brief";
}

function globalFlagLines(options: HelpOptions): readonly string[] {
  const mode = options.mode ?? DEFAULT_HELP_MODE;
  return list(GLOBAL_FLAGS.map((flag) => [flagUsage(flag), flagDescription(flag, mode)] as const));
}

/** Two-column layout with the left column padded to a common width. */
function list(rows: readonly (readonly [string, string])[]): readonly string[] {
  const width = rows.reduce((max, [left]) => Math.max(max, left.length), 0);
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}
