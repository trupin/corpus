import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveTemplateRoot } from "../paths.js";
import { GLOBAL_FLAGS } from "../registry/globals.js";
import type { Registry } from "../registry/types.js";
import type { ToolRoots } from "./incoming.js";
import { planTemplateInstall } from "./install.js";

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
 *
 * ## Which tool's surface the scan judges against (CLI-084)
 *
 * The scan must judge the **incoming** tool's template against the **incoming**
 * tool's surface, and one command makes those two different things. `corpus
 * upgrade` installs the new package and then syncs the template *from the same
 * process it started in*: the template is re-read off disk, so it is the new
 * one, but the registry is a value this process loaded at startup, so it is the
 * old one. The result is the exact false positive CLI-084 reports — a 0.32.0
 * binary writing 0.33.0's `converse/SKILL.md` and then flagging `corpus thread
 * digest`, a verb 0.33.0 ships and 0.32.0 never had. Left alone, every release
 * that adds a verb its own skills teach would false-positive the same way.
 *
 * The new surface cannot be read directly: a released package carries no
 * machine-readable command list, and importing its bundle would run the new
 * tool's entry point inside the old process. What the upgrade *does* hold is the
 * new tool's own instructions, and those are written by whoever wrote its
 * registry. **So the incoming template vouches for the commands it invokes**: a
 * `corpus …` line in a file the tool itself ships is evidence the tool that
 * ships it has that command. Passing `tool` turns those citations into
 * additional surface, on top of the registry this build has.
 *
 * The purpose survives, because a release that drops a verb also stops teaching
 * it: a workspace file citing a verb the incoming template never invokes is
 * still reported, which is CLI-059's whole case. What is given up is narrow and
 * named — a verb the incoming tool has but its own skills never mention is still
 * flagged, and a verb the incoming tool ships broken instructions for is not.
 * Both err toward silence, which is this module's standing bias.
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
  /**
   * Where the **incoming** tool's template lives, when the caller is an upgrade
   * (CLI-084). Its own instructions vouch for the commands they invoke, which is
   * how `corpus upgrade` stops judging the package it just installed against the
   * registry the running process started with. Omitted, the scan judges against
   * `registry` alone — right for every caller whose tool did not move under it.
   */
  readonly tool?: ToolRoots;
}

/**
 * The registry's surface, widened by whatever the incoming template vouches for.
 *
 * Forgiving in the same way the scan is: a template root that cannot be resolved
 * or read leaves the base surface in place, because an upgrade that failed to
 * read the tool's own files has bigger news than a citation report.
 */
function scanSurface(scan: StaleVerbScan): CommandSurface {
  const base = commandSurface(scan.registry);
  return scan.tool === undefined ? base : vouchedSurface(base, scan.tool);
}

/**
 * `base`, plus every command the incoming tool's own markdown invokes.
 *
 * Three cases, and the difference between them is what stops the vouching from
 * swallowing the report whole:
 *
 * - a first token this build already has as a command — nothing to add;
 * - a first token it has as a **topic** — only the named verb is vouched for, so
 *   `corpus thread digest` in the new skills never excuses `corpus thread
 *   frobnicate` in the workspace's;
 * - a first token it knows as neither — the incoming tool grew something whole,
 *   and the name is vouched for outright. Nothing is lost: this build would
 *   report every `corpus <that name> …` line under one finding anyway.
 */
function vouchedSurface(base: CommandSurface, tool: ToolRoots): CommandSurface {
  const commands = new Set(base.commands);
  const verbsByTopic = new Map<string, Set<string>>(
    [...base.verbsByTopic].map(([topic, verbs]): [string, Set<string>] => [topic, new Set(verbs)]),
  );

  for (const source of incomingInstructions(tool)) {
    for (const { tokens } of invocationsIn(source)) {
      const [first, second] = tokens;
      if (first === undefined || !NAME_PATTERN.test(first)) continue;
      if (commands.has(first)) continue;
      const verbs = verbsByTopic.get(first);
      if (verbs === undefined) {
        commands.add(first);
        continue;
      }
      if (second === undefined || !NAME_PATTERN.test(second)) continue;
      verbs.add(second);
    }
  }
  return { commands, verbsByTopic };
}

/**
 * The text of every markdown file the incoming tool would install, or none when
 * the template cannot be read. Only `.md`: the rest of the template is a
 * gitignore, a config skeleton and seed data, none of which instructs anybody.
 */
function incomingInstructions(tool: ToolRoots): readonly string[] {
  let root: string;
  let planned: ReturnType<typeof planTemplateInstall>;
  try {
    root = tool.templateRoot ?? resolveTemplateRoot();
    planned = planTemplateInstall(root);
  } catch {
    return [];
  }

  const sources: string[] = [];
  for (const file of planned) {
    if (!file.to.endsWith(".md")) continue;
    const source = readTextFile(join(root, ...file.from.split("/")));
    if (source !== null) sources.push(source);
  }
  return sources;
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
  const surface = scanSurface(scan);
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
  for (const invocation of invocationsIn(source)) {
    const stale = resolveInvocation(invocation.tokens, surface);
    if (stale === null) continue;
    found.push({
      path,
      line: invocation.line,
      command: stale.command,
      text: invocation.text,
      hint: stale.hint,
    });
  }
  return found;
}

/** One `corpus …` command found in a document, before anything judges it. */
interface Invocation {
  /** Positional names only, flags removed, capped at two — see {@link corpusInvocations}. */
  readonly tokens: readonly string[];
  readonly line: number;
  /** The line as written, trimmed. */
  readonly text: string;
}

/**
 * Every `corpus …` command a document contains, wherever a document is read as
 * instructions rather than as prose.
 *
 * Separate from {@link citationsIn} because two callers need the same reading
 * and must not disagree about it: the report asks which of these the tool lacks,
 * and {@link vouchedSurface} asks which of these the incoming tool has. One
 * walker means a line the report would read as a command is a line the vouching
 * reads as a command.
 */
function invocationsIn(source: string): readonly Invocation[] {
  const found: Invocation[] = [];
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
      for (const tokens of corpusInvocations(candidate)) {
        found.push({ tokens, line: index + 1, text: line.trim() });
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
