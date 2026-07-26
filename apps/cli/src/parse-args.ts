import { UsageError } from "./errors.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
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

export class ParsedArgs {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: ReadonlyMap<string, string>) {
    this.#values = values;
  }

  /** A required positional; absence is a registry bug, not user input. */
  get(name: string): string {
    const value = this.#values.get(name);
    if (value === undefined) {
      throw new Error(`No positional argument named "${name}" was parsed for this command.`);
    }
    return value;
  }

  optional(name: string): string | undefined {
    return this.#values.get(name);
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
}

export function parseCommandInput(target: ParseTarget, tokens: readonly string[]): ParsedInput {
  const { flags, positionals } = parseFlags(target, tokens);
  return { args: bindPositionals(target, positionals), flags };
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
      throw unknownFlagError(token, target.name, specs);
    }

    if (spec.type === "boolean") {
      values.set(spec.name, readBoolean(spec, inlineValue));
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
  return { flags: new ParsedFlags(values), positionals };
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
  const values = new Map<string, string>();
  target.args.forEach((spec, index) => {
    const value = positionals[index];
    if (value === undefined) {
      if (spec.required) {
        throw new UsageError(`missing required argument <${spec.name}> for "${target.name}".`, {
          hint: `Usage: ${synopsis(target)}`,
        });
      }
      return;
    }
    values.set(spec.name, value);
  });

  const extra = positionals.slice(target.args.length);
  const unexpected = extra[0];
  if (unexpected !== undefined) {
    throw new UsageError(`unexpected argument "${unexpected}" for "${target.name}".`, {
      hint: `Usage: ${synopsis(target)}`,
    });
  }
  return new ParsedArgs(values);
}

function synopsis(target: ParseTarget): string {
  const args = target.args.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`));
  return [target.name, ...args, "[flags]"].join(" ");
}
