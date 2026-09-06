import { countWords, gloss, MAX_GLOSS_WORDS } from "../gloss.js";
import { HELP_MODES, renderCommandHelp, renderTopicHelp, type HelpMode } from "../help.js";
import { GLOBAL_FLAGS, GLOBAL_FLAG_ALIASES, GLOBAL_FLAG_NAMES } from "./globals.js";
import type { ArgSpec, CommandSpec, FlagSpec, Registry, TopicSpec } from "./types.js";

/**
 * Structural validation of the command surface. It runs when the registry module
 * loads and inside the docs generator, so a malformed registry fails loudly
 * instead of quietly producing wrong help text and a wrong `docs/cli.md`.
 *
 * The rule that matters most: every command carries at least one example. That
 * is the mechanism that keeps the generated reference worth reading.
 *
 * The gloss rule below is the second of that kind. `--help=brief` renders the
 * first sentence of every description as its one-line gloss (CLI-056), so an
 * opening sentence longer than {@link MAX_GLOSS_WORDS} words is not a style
 * preference — it is a brief help that is not brief. Failing at module load is
 * what makes "every flag has a gloss" true by construction rather than by
 * review.
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

/**
 * What one help page may cost the reader, in bytes of rendered output
 * (CLI-080). The gloss rule above bounds a single line; nothing bounded the
 * page, and by 2026-09 the fifteen hot verbs' full help totalled ~134KB — a
 * second orchestrate-sized document read through `--help`. These caps gate the
 * build the way a malformed gloss does, so the surface cannot regrow past them
 * one honest-looking paragraph at a time.
 *
 * The budget measures the **rendered register**, through the same renderer the
 * dispatcher calls (`help.ts`, `color: false`), not the source literals: what a
 * reader pays is the output, layout and global flags included. Brief gets
 * ~400 tokens — it answers "what is the flag called?" and every flag must still
 * appear (its line is the first sentence of the full text, CLI-056), so the fix
 * for a breach is shorter opening sentences, never fewer flags. Full gets
 * ~2,000 tokens — room for every stated behaviour and consequence, not for the
 * same rule told three times.
 *
 * Topic pages (`corpus doc --help`) are held to the same caps: they are read
 * through the same hole, and a topic page is one summary line per verb plus an
 * optional description, so a breach means the topic has outgrown a single
 * listing.
 */
export const HELP_BUDGET_BYTES: Readonly<Record<HelpMode, number>> = {
  brief: 1_600,
  full: 8_000,
};

/**
 * The one-line form `--help=brief` will print for this declaration, checked for
 * length. A non-empty description always yields a non-empty gloss — the first
 * sentence of a string with no terminator is the whole string — so the failure
 * this catches is never a blank line, only a paragraph pretending to be one.
 */
function glossProblems(declaration: ArgSpec | FlagSpec, label: string): readonly string[] {
  const words = countWords(gloss(declaration.description));
  if (words <= MAX_GLOSS_WORDS) return [];
  return [
    `${label} opens with a ${String(words)}-word sentence; \`--help=brief\` prints it as the ` +
      `one-line gloss, so it must be at most ${String(MAX_GLOSS_WORDS)} words ` +
      `(split the sentence — the full text keeps everything)`,
  ];
}

function flagGlossProblems(flag: FlagSpec, label: string): readonly string[] {
  return glossProblems(flag, `${label} flag "--${flag.name}"`);
}

/**
 * Both registers of one help page measured against {@link HELP_BUDGET_BYTES},
 * rendered exactly as the dispatcher would render them (`color: false` — escape
 * codes are terminal dressing, not content a reader pays for).
 */
function helpBudgetProblems(render: (mode: HelpMode) => string, label: string): readonly string[] {
  const problems: string[] = [];
  for (const mode of HELP_MODES) {
    const budget = HELP_BUDGET_BYTES[mode];
    const size = Buffer.byteLength(render(mode), "utf8");
    if (size > budget) {
      const register = mode === "brief" ? "--help=brief" : "--help";
      problems.push(
        `${label} renders ${String(size)} bytes of ${mode} help (\`${register}\`), over its ` +
          `${String(budget)}-byte budget — compress the descriptions; the budget counts the ` +
          `bytes a reader pays`,
      );
    }
  }
  return problems;
}

export function collectRegistryProblems(registry: Registry): readonly string[] {
  const problems: string[] = [];

  if (registry.summary.trim() === "") problems.push("the registry has no summary");

  // Globals are merged into every command's help, brief included, so they are
  // held to the same gloss rule even though no command declares them.
  for (const flag of GLOBAL_FLAGS) {
    problems.push(...flagGlossProblems(flag, "the global flag"));
  }

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
  problems.push(
    ...helpBudgetProblems((mode) => renderTopicHelp(topic, { color: false, mode }), label),
  );

  const seen = new Set<string>();
  for (const command of topic.commands) {
    if (seen.has(command.name)) {
      problems.push(`${label} declares "${command.name}" twice`);
    }
    seen.add(command.name);
    problems.push(...commandProblems(command, `${label} ${command.name}`, topic.name));
  }
  return problems;
}

function commandProblems(command: CommandSpec, label: string, topic?: string): readonly string[] {
  const problems: string[] = [];

  if (!NAME_PATTERN.test(command.name)) {
    problems.push(`command name "${command.name}" is not kebab-case`);
  }
  if (command.summary.trim() === "") problems.push(`${label} has no summary`);
  if (command.examples.length === 0) problems.push(`${label} has no examples`);
  problems.push(
    ...helpBudgetProblems(
      (mode) =>
        renderCommandHelp(command, {
          color: false,
          mode,
          ...(topic === undefined ? {} : { topic }),
        }),
      label,
    ),
  );

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
    problems.push(...glossProblems(arg, `${label} argument "${arg.name}"`));
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
    problems.push(...flagGlossProblems(flag, label));
    if (flag.bareValue !== undefined && flag.type !== "string") {
      problems.push(`${label} flag "--${flag.name}" declares a bareValue but is not a string flag`);
    }
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
