import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_FLAGS } from "../registry/globals.js";
import type { Registry } from "../registry/types.js";

/**
 * Skills that teach a command this tool does not have (CLI-059).
 *
 * `corpus init` installs the agent's skills into a workspace, and from that
 * moment they are the workspace's documents — the tool cannot rewrite them, only
 * offer an update the operator may keep or refuse (SPEC.md §2.1, §2.4). So a
 * verb the tool removes lives on in every workspace created before the removal,
 * and in every skill the agent has edited since. `corpus skill rollback` is the
 * worked example: CLI-040 deleted it under SHARED-042, and a workspace that has
 * not run the template sync still tells its agent to run it.
 *
 * The symptom is the worst kind — the agent's own instructions name a command
 * that does not exist, and it finds out by trying, one wasted turn at a time. So
 * the upgrade report says so, because an upgrade is the moment the tool's
 * surface moves under a workspace that did not move with it.
 *
 * **The registry is the source of truth, never a list of removed verbs.** A
 * hand-kept list only knows the removals somebody remembered to write down; the
 * registry knows what this build actually has, so it is right about a verb that
 * was renamed, moved between topics, or never existed at all.
 *
 * ## What counts as a citation
 *
 * Only code: a line inside a fenced block, or an inline `` `corpus …` `` span.
 * Prose that merely says the word corpus is never scanned, and a heredoc body
 * inside a fenced block is skipped to its terminator — a reply whose text starts
 * with the word corpus is content, not a command.
 *
 * A sentence *explaining* that a verb was removed is the false positive that
 * matters, and flagging it would be worse than no check at all. Two rules keep
 * it out: such a sentence is prose, so its only route in is an inline span, and
 * an inline span on a line carrying a removal phrase ("no longer", "was
 * removed", "there is no") is not read as an instruction. It is a heuristic and
 * it errs toward silence — a real stale citation in a sentence about removals is
 * missed, which costs one turn, where a false one costs trust in the report.
 */

/** One citation of a command the installed tool does not have. */
export interface StaleCitation {
  /** Workspace-relative, `/`-separated, so it reads the same on every platform. */
  readonly path: string;
  /** 1-based line number, so the report can send a reader straight to it. */
  readonly line: number;
  /** The command as the registry failed to resolve it: `skill rollback`. */
  readonly command: string;
  /** The line as written, trimmed — what the reader is looking for on that line. */
  readonly text: string;
  /** The repair, in the same words a person is shown. */
  readonly hint: string;
}

/**
 * Where a workspace keeps instructions written in `corpus` commands.
 *
 * `.claude/skills-archived/` is deliberately absent: an archived skill is one
 * the operator switched off, and Claude Code does not discover it, so a command
 * it names is never run.
 */
const SCANNED_DIRECTORIES = [".claude/skills", ".claude/agents"] as const;
const SCANNED_FILES = ["CLAUDE.md", "README.md"] as const;

/** Phrases that mark a sentence as being *about* a command rather than an instruction. */
const REMOVAL_PHRASES = [
  "no longer",
  "was removed",
  "were removed",
  "been removed",
  "removed in",
  "does not exist",
  "doesn't exist",
  "did not exist",
  "never existed",
  "there is no",
  "no such",
  "used to be",
  "used to exist",
  "replaced by",
  "instead of",
] as const;

/** Global flags that swallow the next token, so a scan does not read it as a name. */
const VALUE_FLAG_NAMES: ReadonlySet<string> = new Set(
  GLOBAL_FLAGS.filter((flag) => flag.type !== "boolean" && flag.bareValue === undefined).map(
    (flag) => `--${flag.name}`,
  ),
);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The installed command surface, in the shape the resolver asks questions of. */
export interface CommandSurface {
  readonly commands: ReadonlySet<string>;
  readonly verbsByTopic: ReadonlyMap<string, ReadonlySet<string>>;
}

export function commandSurface(registry: Registry): CommandSurface {
  return {
    commands: new Set(registry.commands.map((command) => command.name)),
    verbsByTopic: new Map(
      registry.topics.map((topic) => [
        topic.name,
        new Set(topic.commands.map((command) => command.name)),
      ]),
    ),
  };
}

export interface StaleVerbScan {
  readonly root: string;
  readonly registry: Registry;
}

/**
 * Every stale citation in a workspace's instruction files, in file then line
 * order.
 *
 * Read-only and forgiving, for the same reason the migration detectors are: a
 * file that cannot be read is skipped rather than failed, because an upgrade
 * that died on an unrelated unreadable file would report nothing at all.
 */
export function staleVerbCitations(scan: StaleVerbScan): readonly StaleCitation[] {
  const surface = commandSurface(scan.registry);
  const found: StaleCitation[] = [];

  for (const relative of instructionFiles(scan.root)) {
    const source = readTextFile(join(scan.root, ...relative.split("/")));
    if (source === null) continue;
    found.push(...citationsIn(relative, source, surface));
  }
  return found;
}

/** Every markdown file a workspace's agent reads as instructions, sorted. */
export function instructionFiles(root: string): readonly string[] {
  const files: string[] = [];
  for (const name of SCANNED_FILES) {
    if (isFile(join(root, name))) files.push(name);
  }
  for (const directory of SCANNED_DIRECTORIES) {
    for (const nested of markdownFilesUnder(join(root, ...directory.split("/")))) {
      files.push(`${directory}/${nested}`);
    }
  }
  return files;
}

/**
 * The citations in one document. Exported for the tests, which drive it on
 * strings rather than on a directory tree.
 */
export function citationsIn(
  path: string,
  source: string,
  surface: CommandSurface,
): readonly StaleCitation[] {
  const found: StaleCitation[] = [];
  let inFence = false;
  let heredocTerminator: string | null = null;

  source.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");

    if (heredocTerminator !== null) {
      if (line.trim() === heredocTerminator) heredocTerminator = null;
      return;
    }
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }

    // Inside a fence every line is a command line; outside one, only what is in
    // an inline code span is, and only when the sentence around it is not
    // explaining that the command is gone.
    const sources = inFence ? [line] : lineExplainsARemoval(line) ? [] : inlineCodeSpans(line);

    for (const candidate of sources) {
      for (const invocation of corpusInvocations(candidate)) {
        const stale = resolveInvocation(invocation, surface);
        if (stale === null) continue;
        found.push({
          path,
          line: index + 1,
          command: stale.command,
          text: line.trim(),
          hint: stale.hint,
        });
      }
    }

    if (inFence) {
      const opener = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
      if (opener?.[1] !== undefined) heredocTerminator = opener[1];
    }
  });

  return found;
}

function lineExplainsARemoval(line: string): boolean {
  const lowered = line.toLowerCase();
  return REMOVAL_PHRASES.some((phrase) => lowered.includes(phrase));
}

/** The contents of every `` `…` `` span on a line. */
function inlineCodeSpans(line: string): readonly string[] {
  const spans: string[] = [];
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const span = match[1];
    if (span !== undefined) spans.push(span);
  }
  return spans;
}

/**
 * The token lists of every `corpus …` command on one line, flags removed. A
 * compound line is several commands, and only a segment that *starts* with
 * `corpus` is one — a line that mentions the word further along is output or
 * prose.
 */
function corpusInvocations(candidate: string): readonly (readonly string[])[] {
  const invocations: (readonly string[])[] = [];

  for (const segment of candidate.split(/&&|\|\||[|;]/)) {
    // A `$ ` prompt and a leading `#` comment are both common in worked blocks.
    const trimmed = segment.trim().replace(/^\$\s+/, "");
    if (!/^corpus(\s|$)/.test(trimmed)) continue;

    const words = trimmed.split(/\s+/).slice(1);
    const tokens: string[] = [];
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      if (word === undefined || word === "") continue;
      if (word.startsWith("-")) {
        if (VALUE_FLAG_NAMES.has(word)) index += 1;
        continue;
      }
      tokens.push(word);
      if (tokens.length === 2) break;
    }
    invocations.push(tokens);
  }
  return invocations;
}

interface Unresolved {
  readonly command: string;
  readonly hint: string;
}

/**
 * `null` when the installed surface has this command, and the finding otherwise.
 *
 * A token that is not a plain name — `<id>`, `$LANE`, `"…"` — is a placeholder
 * in a written example, and no claim is made about it: reporting one would be
 * flagging the documentation's own syntax.
 */
function resolveInvocation(tokens: readonly string[], surface: CommandSurface): Unresolved | null {
  const [first, second] = tokens;
  // `corpus --help` and friends name no command at all.
  if (first === undefined || !NAME_PATTERN.test(first)) return null;
  if (surface.commands.has(first)) return null;

  const verbs = surface.verbsByTopic.get(first);
  if (verbs === undefined) {
    return {
      command: first,
      hint: "`corpus --help=brief` lists every command this tool has.",
    };
  }
  // A bare topic is a legal invocation: it prints that topic's help.
  if (second === undefined || !NAME_PATTERN.test(second)) return null;
  if (verbs.has(second)) return null;

  return {
    command: `${first} ${second}`,
    hint: `\`corpus ${first} --help=brief\` lists the verbs \`corpus ${first}\` has.`,
  };
}

function readTextFile(absolute: string): string | null {
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/** Every `.md` under `directory`, `/`-separated and sorted, or none when it is absent. */
function markdownFilesUnder(directory: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (entry.isDirectory()) {
      for (const nested of markdownFilesUnder(join(directory, entry.name))) {
        found.push(`${entry.name}/${nested}`);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(entry.name);
    }
  }
  return found;
}
