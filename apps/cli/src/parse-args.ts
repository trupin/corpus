import { UsageError } from "./errors.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import { removedFlagHint, removedFlagMessage } from "./removed-flags.js";
import type { ArgSpec, FlagSpec } from "./registry/types.js";
import { suggest } from "./suggest.js";

/**
 * A flag parser driven entirely by the command's own `FlagSpec[]` (SPEC.md
 * §2.3). Deliberately not an external arg-parsing library: a second declaration
 * of the flags would fork the source of truth that the registry exists to be.
 */

export type FlagValue = boolean | string | number | readonly (string | number)[];

export class ParsedFlags {
  readonly #values: ReadonlyMap<string, FlagValue>;

  constructor(values: ReadonlyMap<string, FlagValue>) {
    this.#values = values;
  }

  /**
   * The same flags with one value replaced — how `--flag-file` puts a file's
   * bytes where the flag's value would have been (CLI-074).
   *
   * A new instance rather than a mutation: a handler reads its flags through
   * this class and must not be able to tell whether a value arrived on the
   * command line or out of a file. That indistinguishability is the whole
   * mechanism, and it is what makes it work for verbs nobody has written yet.
   */
  with(name: string, value: FlagValue): ParsedFlags {
    const next = new Map(this.#values);
    next.set(name, value);
    return new ParsedFlags(next);
  }

  boolean(name: string): boolean {
    const value = this.#values.get(name);
    return typeof value === "boolean" ? value : false;
  }

  string(name: string): string | undefined {
    const value = this.#values.get(name);
    return typeof value === "string" ? value : undefined;
  }

  number(name: string): number | undefined {
    const value = this.#values.get(name);
    return typeof value === "number" ? value : undefined;
  }

  strings(name: string): readonly string[] {
    const value = this.#values.get(name);
    if (!isValueList(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }
}

/** A positional's bound value: one token, or every token a variadic argument absorbed. */
export type ArgValue = string | readonly string[];

export class ParsedArgs {
  readonly #values: ReadonlyMap<string, ArgValue>;

  constructor(values: ReadonlyMap<string, ArgValue>) {
    this.#values = values;
  }

  /** A required positional; absence is a registry bug, not user input. */
  get(name: string): string {
    const value = this.#values.get(name);
    if (typeof value !== "string") {
      throw new Error(`No positional argument named "${name}" was parsed for this command.`);
    }
    return value;
  }

  optional(name: string): string | undefined {
    const value = this.#values.get(name);
    return typeof value === "string" ? value : undefined;
  }

  /**
   * Every token bound to an argument, in order. A scalar reads as a one-element
   * list and an absent argument as an empty one, so a handler never has to know
   * which of the two shapes its registry entry declared.
   */
  list(name: string): readonly string[] {
    const value = this.#values.get(name);
    if (value === undefined) return [];
    return typeof value === "string" ? [value] : value;
  }
}

export interface ParsedInput {
  readonly args: ParsedArgs;
  readonly flags: ParsedFlags;
}

/** The subset of a `CommandSpec` the parser needs; keeps the parser testable with fixtures. */
export interface ParseTarget {
  readonly name: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
}

export function mergedFlags(flags: readonly FlagSpec[]): readonly FlagSpec[] {
  return [...GLOBAL_FLAGS, ...flags];
}

export interface ParsedFlagsAndPositionals {
  readonly flags: ParsedFlags;
  readonly positionals: readonly string[];
  /**
   * Flag names the caller actually typed.
   *
   * Distinct from "has a value", because {@link applyDefaults} gives absent
   * flags their defaults — so a flag can hold a value nobody asked for. The
   * difference matters to exactly one caller: `--flag-file title=…` beside
   * `--title` is a conflict, and a default must not be mistaken for one.
   */
  readonly provided: ReadonlySet<string>;
}

export function parseCommandInput(target: ParseTarget, tokens: readonly string[]): ParsedInput {
  const { flags, positionals } = parseFlags(target, tokens);
  return { args: bindPositionals(target, positionals), flags };
}

/** The flag `--flag-file` is, spelled once. */
export const FLAG_FILE = "flag-file";

/** One `--flag-file <name>=<path>`, split but not yet read. */
export interface FlagFileRequest {
  readonly name: string;
  readonly path: string;
}

/**
 * The `<name>=<path>` pairs the caller gave, split on the **first** `=`.
 *
 * First, because a flag name never contains one and a path may. Splitting on the
 * last would make `--flag-file title=/tmp/a=b.txt` name a flag called
 * `title=/tmp/a`, which exists nowhere and would be reported as a misspelling of
 * something the caller never typed.
 */
export function flagFileRequests(flags: ParsedFlags): readonly FlagFileRequest[] {
  return flags.strings(FLAG_FILE).map((raw) => {
    const separator = raw.indexOf("=");
    if (separator <= 0) {
      throw new UsageError(`--${FLAG_FILE} ${raw} is not <flag>=<path>.`, {
        hint: `Usage: --${FLAG_FILE} title=/tmp/title.txt`,
      });
    }
    return { name: raw.slice(0, separator), path: raw.slice(separator + 1) };
  });
}

/**
 * Flags first, positionals unbound. `--help` must win over "missing required
 * argument": asking for help is exactly what someone who does not know the
 * arguments does.
 */
export function parseFlags(
  target: ParseTarget,
  tokens: readonly string[],
): ParsedFlagsAndPositionals {
  const specs = mergedFlags(target.flags);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const byAlias = new Map(
    specs.flatMap((spec) => (spec.alias === undefined ? [] : [[spec.alias, spec] as const])),
  );

  const values = new Map<string, FlagValue>();
  const provided = new Set<string>();
  const positionals: string[] = [];
  const remaining = [...tokens];
  let literal = false;

  while (remaining.length > 0) {
    const token = remaining.shift();
    if (token === undefined) break;

    if (literal) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      continue;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith("--");
    const body = isLong ? token.slice(2) : token.slice(1);
    const separator = body.indexOf("=");
    const key = separator === -1 ? body : body.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : body.slice(separator + 1);

    const spec = isLong ? byName.get(key) : byAlias.get(key);
    if (spec === undefined) {
      // A flag that used to exist is a different mistake from a misspelled one:
      // the spelling is right and the surface moved, so the answer names the
      // release and what replaced it rather than listing every valid flag.
      if (isLong) assertNotRemoved(key);
      throw unknownFlagError(token, target.name, specs);
    }

    provided.add(spec.name);

    if (spec.type === "boolean") {
      values.set(spec.name, readBoolean(spec, inlineValue));
      continue;
    }

    // A flag declaring `bareValue` takes its value from the inline form alone.
    // Reading the next token would make `corpus doc list --help` swallow a
    // positional and `corpus --help` swallow the command name (CLI-056).
    if (spec.bareValue !== undefined) {
      values.set(spec.name, inlineValue ?? spec.bareValue);
      continue;
    }

    const raw = inlineValue ?? remaining.shift();
    if (raw === undefined) {
      throw new UsageError(`flag --${spec.name} requires a value.`, {
        hint: `Usage: --${spec.name} <${spec.valueName ?? spec.type}>`,
      });
    }
    assign(values, spec, spec.type === "number" ? readNumber(spec, raw) : raw);
  }

  applyDefaults(values, specs);
  return { flags: new ParsedFlags(values), positionals, provided };
}

/**
 * Refuses a flag this CLI has removed, with the epitaph `removed-flags.ts`
 * carries for it.
 *
 * Checked before the "unknown flag" fallback and **not** per command: a removed
 * flag is removed from the tool, and the caller who types it on a verb that
 * never had it is making the same mistake — carrying an older surface — as the
 * one who types it on the verb that did.
 */
function assertNotRemoved(name: string): void {
  const message = removedFlagMessage(name);
  if (message === undefined) return;
  const hint = removedFlagHint(name);
  throw new UsageError(message, hint === undefined ? {} : { hint });
}

function unknownFlagError(
  token: string,
  commandName: string,
  specs: readonly FlagSpec[],
): UsageError {
  const names = specs.map((spec) => `--${spec.name}`);
  const suggestion = suggest(token, names);
  return new UsageError(`unknown flag "${token}" for "${commandName}".`, {
    hint:
      suggestion === undefined
        ? `Known flags: ${names.join(", ")}`
        : `Did you mean ${suggestion}? Known flags: ${names.join(", ")}`,
  });
}

function readBoolean(spec: FlagSpec, inlineValue: string | undefined): boolean {
  if (inlineValue === undefined) return true;
  if (inlineValue === "true") return true;
  if (inlineValue === "false") return false;
  throw new UsageError(
    `flag --${spec.name} is a boolean; expected "true" or "false", got "${inlineValue}".`,
  );
}

function readNumber(spec: FlagSpec, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new UsageError(`flag --${spec.name} expects a number, got "${raw}".`);
  }
  return value;
}

/** Only value-taking flags reach here; registry validation forbids `repeated` booleans. */
function assign(values: Map<string, FlagValue>, spec: FlagSpec, value: string | number): void {
  if (spec.repeated !== true) {
    values.set(spec.name, value);
    return;
  }
  const previous = values.get(spec.name);
  const list: (string | number)[] = isValueList(previous) ? [...previous] : [];
  list.push(value);
  values.set(spec.name, list);
}

function isValueList(value: FlagValue | undefined): value is readonly (string | number)[] {
  return Array.isArray(value);
}

function applyDefaults(values: Map<string, FlagValue>, specs: readonly FlagSpec[]): void {
  for (const spec of specs) {
    if (values.has(spec.name)) continue;
    if (spec.repeated === true) {
      values.set(spec.name, []);
    } else if (spec.default !== undefined) {
      values.set(spec.name, spec.default);
    } else if (spec.type === "boolean") {
      values.set(spec.name, false);
    }
  }
}

export function bindPositionals(target: ParseTarget, positionals: readonly string[]): ParsedArgs {
  const values = new Map<string, ArgValue>();

  for (const [index, spec] of target.args.entries()) {
    // A variadic argument is the last one (registry validation enforces it) and
    // absorbs everything from its own position onward, so the "unexpected
    // argument" check below is unreachable once one is declared.
    if (spec.variadic === true) {
      const rest = positionals.slice(index);
      if (rest.length === 0 && spec.required) throw missingArgument(target, spec);
      values.set(spec.name, rest);
      return new ParsedArgs(values);
    }

    const value = positionals[index];
    if (value === undefined) {
      if (spec.required) throw missingArgument(target, spec);
      continue;
    }
    values.set(spec.name, value);
  }

  const unexpected = positionals[target.args.length];
  if (unexpected !== undefined) {
    throw new UsageError(`unexpected argument "${unexpected}" for "${target.name}".`, {
      hint: `Usage: ${synopsis(target)}`,
    });
  }
  return new ParsedArgs(values);
}

function missingArgument(target: ParseTarget, spec: ArgSpec): UsageError {
  return new UsageError(`missing required argument ${argUsage(spec)} for "${target.name}".`, {
    hint: `Usage: ${synopsis(target)}`,
  });
}

/**
 * How one positional is written in help, in the synopsis and in `docs/cli.md` —
 * `<id>` required, `[id]` optional, `<id>…` when it absorbs the rest. One
 * function so the three renderings cannot disagree about a command's shape.
 */
export function argUsage(arg: ArgSpec): string {
  const name = arg.variadic === true ? `${arg.name}…` : arg.name;
  return arg.required ? `<${name}>` : `[${name}]`;
}

function synopsis(target: ParseTarget): string {
  return [target.name, ...target.args.map(argUsage), "[flags]"].join(" ");
}
