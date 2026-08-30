import { UsageError } from "./errors.js";
import { readFlagFile, type InputDependencies } from "./input.js";
import {
  FLAG_FILE,
  flagFileRequests,
  mergedFlags,
  type ParsedFlags,
  type ParsedFlagsAndPositionals,
  type ParseTarget,
} from "./parse-args.js";
import type { FlagSpec } from "./registry/types.js";
import { suggest } from "./suggest.js";

/**
 * `--flag-file <name>=<path>` (CLI-074): a flag's value read from a file, so the
 * words in it never pass through a shell.
 *
 * **Its own module, and that is load-bearing rather than tidy.** It belongs
 * beside `input.ts`, which is where every other value source lives — but
 * `registry/globals.ts` imports `input.ts` for `FROM_FLAG`, and `parse-args.ts`
 * imports `registry/globals.ts`. A runtime import of `parse-args.ts` from
 * `input.ts` closes that ring, and the first module to be loaded then builds
 * `GLOBAL_FLAGS` out of an uninitialised `FROM_FLAG`. Found by a test that
 * imported this file first and got `Cannot read properties of undefined`.
 */

/**
 * `--flag-file <name>=<path>` resolved: every named flag's value replaced by its
 * file's bytes (CLI-074).
 *
 * **Why this exists, in one paragraph.** SPEC.md §7 makes the CLI the agent's
 * only door, so every value a person wrote reaches Corpus as a shell argument.
 * The skills tell the agent to build such a value in a quoted heredoc, which is
 * correct for every character — and not for one thing the value can do to
 * itself. A carried message containing a line that reads like the heredoc's
 * terminator ends the quoting early; the lines after it run as commands, and
 * their output is captured into the value. CLI-051 measured it: a `touch`
 * executed, `echo`'s stdout landed in the document as though a person had typed
 * it, and the tail of the message was intact so nothing looked truncated.
 *
 * Guidance cannot close that, because the agent builds the value correctly and
 * the **content** decides the outcome. A path can: the bytes are read here, and
 * no shell ever sees them.
 *
 * **Every failure below is loud.** A silent precedence — preferring the flag, or
 * preferring the file — would be a caller not knowing which value shipped, which
 * is the same species of defect as the one this removes.
 */
export async function resolveFlagFiles(
  target: ParseTarget,
  parsed: ParsedFlagsAndPositionals,
  context: { readonly cwd: string },
  dependencies: InputDependencies = {},
): Promise<ParsedFlags> {
  const requests = flagFileRequests(parsed.flags);
  if (requests.length === 0) return parsed.flags;

  const specs = mergedFlags(target.flags);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const seen = new Set<string>();
  let flags = parsed.flags;

  for (const request of requests) {
    const spec = byName.get(request.name);
    if (spec === undefined) {
      throw new UsageError(`--${FLAG_FILE} names no flag --${request.name}.`, {
        hint: nearestFlagHint(request.name, specs),
      });
    }
    if (spec.name === FLAG_FILE) {
      // Reading the flag's own value out of a file would mean a file naming the
      // files, which is a level of indirection with no caller and one more place
      // for a value to come from than anyone can hold in their head.
      throw new UsageError(`--${FLAG_FILE} cannot set itself.`, {
        hint: `Name the flag whose value the file holds: --${FLAG_FILE} title=/tmp/title.txt`,
      });
    }
    if (spec.type !== "string") {
      throw new UsageError(`--${request.name} takes no text, so it cannot come from a file.`, {
        hint: `--${request.name} is a ${spec.type} flag. --${FLAG_FILE} reads text.`,
      });
    }
    if (parsed.provided.has(spec.name)) {
      throw new UsageError(`--${spec.name} was given twice: once directly, once from a file.`, {
        hint: `Pass the value one way. For words somebody else wrote, use --${FLAG_FILE} ${spec.name}=<path> alone.`,
      });
    }
    if (seen.has(spec.name) && spec.repeated !== true) {
      throw new UsageError(`--${spec.name} takes one value, and two files were named for it.`, {
        hint: `--${spec.name} is not repeatable.`,
      });
    }
    seen.add(spec.name);

    const value = oneLessTrailingNewline(
      await readFlagFile(context, FLAG_FILE, request.path, dependencies),
    );
    flags =
      spec.repeated === true
        ? flags.with(spec.name, [...flags.strings(spec.name), value])
        : flags.with(spec.name, value);
  }

  return flags;
}

/**
 * One trailing newline removed, and only one.
 *
 * Every ordinary way of writing a file ends it with a newline, so keeping it
 * would give *every* title passed this way a trailing blank — which YAML then
 * serialises as a block scalar, and the board shows a title with a line break in
 * it. The caller would have to remember `printf` over `echo` for a value whose
 * newline they never thought about.
 *
 * It is also what the idiom this replaces already did: a quoted heredoc read
 * through `$(cat …)`
 * strips trailing newlines, so a skill rewritten to pass a path gets the same
 * value it got before.
 *
 * **Only for a flag, and never for a body.** `--file` reads a body and keeps its
 * bytes exactly, because a document's final newline is content. A flag's value
 * is a title, a reason, a description — a thing that ends where its words end.
 * The two rules differ because the two things do.
 */
function oneLessTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

/** The nearest flag name to one nobody declared, phrased as a repair. */
function nearestFlagHint(name: string, specs: readonly FlagSpec[]): string {
  const nearest = suggest(
    name,
    specs.filter((spec) => spec.type === "string").map((spec) => spec.name),
  );
  return nearest === undefined
    ? `This command takes no --${name}. Run it with --help to see what it does take.`
    : `Did you mean --${FLAG_FILE} ${nearest}=…?`;
}
