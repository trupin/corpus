/**
 * The workspace template (`assets/workspace/`) is product code: `corpus init`
 * copies it verbatim into a new user workspace. This module is the repo-side
 * loader and the machine-readable half of the install contract documented in
 * `docs/workspace-template.md` — the rename table, the copy filter, and the list
 * of things `corpus init` generates rather than copies.
 *
 * `scripts/workspace-template.test.ts` asserts the document and these exports
 * agree, so the contract CLI-002 implements cannot drift from its documentation.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const TEMPLATE_ROOT = path.join(REPO_ROOT, "assets", "workspace");
export const CONTRACT_DOC_PATH = path.join(REPO_ROOT, "docs", "workspace-template.md");

/**
 * The bundled plugins tree. `corpus init` installs each plugin's
 * `skills/<name>/` into the same `.claude/skills/` the template fills, so the
 * two trees are one product surface once a workspace exists — which is why the
 * rules this module's test applies to skills read from both roots (PLUGINS-013).
 */
export const PLUGINS_ROOT = path.join(REPO_ROOT, "plugins");

/** Raised for any malformed template input, always naming the offending path. */
export class TemplateError extends Error {
  override readonly name = "TemplateError";
}

export interface InstallRename {
  /** Path inside `assets/workspace/`. A trailing `/` marks a directory prefix. */
  readonly template: string;
  /** Path inside the installed workspace. */
  readonly installed: string;
}

/**
 * Dot-prefixed names are not stored in the template: a literal `.claude/` here
 * would be discovered by *this* repository's Claude Code as a directory-scoped
 * dev-harness skill, and a literal `.gitignore` would apply to this repository.
 * They are stored dotless and renamed on install.
 */
export const INSTALL_RENAMES: readonly InstallRename[] = [
  { template: "claude/", installed: ".claude/" },
  { template: "gitignore", installed: ".gitignore" },
];

/**
 * Names dropped during the copy. `.gitkeep` exists only so this repository can
 * track the template's empty directories; `corpus init` creates the directories
 * directly, so copying it would litter every new workspace.
 */
export const INSTALL_FILTERS: readonly string[] = [".gitkeep"];

/**
 * Everything `corpus init` produces itself, in install order — **exhaustively**.
 * The template is fully static (no secrets, no machine-specific paths), which is
 * what makes "copy wholesale" safe; anything host-specific, every directory whose
 * only template content is a filtered `.gitkeep`, and every runtime directory
 * with no template counterpart is generated instead. `corpus workspace upgrade`
 * compares a workspace against this list, so an omission is invisible to it.
 *
 * A trailing `/` marks a directory; `git init` is an action rather than a path.
 * Directories that receive copied files arrive with the copy and are not listed.
 * Kept byte-identical to, and in the same order as, the bullet list in
 * `docs/workspace-template.md`; the directory order tracks
 * `WORKSPACE_DIRECTORIES` in `apps/cli/src/commands/init/scaffold.ts`.
 */
export const INIT_GENERATED: readonly string[] = [
  "data/docs/inbox/",
  "data/threads/",
  ".claude/skills-archived/",
  ".claude/agents/",
  ".corpus/queue/",
  // No `.corpus/locks/`: SPEC.md §7's key is derived from a document's content
  // rather than stored, so there is nothing to keep and nothing to reap
  // (SHARED-041, and `WORKSPACE_DIRECTORIES` says the same next to the code).
  ".corpus/jobs/",
  ".corpus/attachments/",
  ".corpus/config.json",
  ".corpus/template-manifest.json",
  "git init",
];

/** Every file in the template tree, as `/`-separated paths relative to its root, sorted. */
export function listTemplateFiles(root: string = TEMPLATE_ROOT): string[] {
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : [rel];
    });
  // Code-unit order, not `localeCompare` — the result feeds an exact-match test
  // and must not depend on the machine's locale.
  return walk(root, "").sort();
}

/**
 * Where a template file lands in an installed workspace, or `null` when the copy
 * filter drops it. This is the whole of `corpus init`'s copy logic: CLI-002
 * applies it path by path and encodes no knowledge of any individual seed file.
 */
export function installedPath(relPath: string): string | null {
  if (INSTALL_FILTERS.includes(path.posix.basename(relPath))) return null;
  for (const { template, installed } of INSTALL_RENAMES) {
    if (template.endsWith("/")) {
      if (relPath.startsWith(template)) return installed + relPath.slice(template.length);
    } else if (relPath === template) {
      return installed;
    }
  }
  return relPath;
}

export interface TemplateDocument {
  readonly relPath: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

/**
 * Split a markdown file into its YAML frontmatter mapping and its body. Fails
 * loudly rather than treating a malformed document as an empty one — a silently
 * frontmatter-less seed document would install into every new workspace.
 */
export function parseFrontmatter(relPath: string, source: string): TemplateDocument {
  const lines = (source.startsWith("\uFEFF") ? source.slice(1) : source).split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    throw new TemplateError(`${relPath}: missing opening frontmatter fence`);
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (closing === -1) {
    throw new TemplateError(`${relPath}: unterminated frontmatter block`);
  }
  const yamlSource = lines.slice(1, closing).join("\n");
  const parsed: unknown = yamlSource.trim() === "" ? {} : parseYaml(yamlSource);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TemplateError(`${relPath}: frontmatter is not a YAML mapping`);
  }
  return {
    relPath,
    frontmatter: parsed as Record<string, unknown>,
    body: lines.slice(closing + 1).join("\n"),
  };
}

/** Parse every `.md` file in the template tree, rejecting duplicate ids. */
export function loadTemplateDocuments(root: string = TEMPLATE_ROOT): TemplateDocument[] {
  const documents = listTemplateFiles(root)
    .filter((relPath) => relPath.endsWith(".md"))
    .map((relPath) => parseFrontmatter(relPath, readFileSync(path.join(root, relPath), "utf8")));

  const seen = new Map<string, string>();
  for (const document of documents) {
    const id = document.frontmatter.id;
    if (typeof id !== "string") continue;
    const previous = seen.get(id);
    if (previous !== undefined) {
      throw new TemplateError(
        `${document.relPath}: duplicate id ${id}, already used by ${previous}`,
      );
    }
    seen.set(id, document.relPath);
  }
  return documents;
}

export interface ContractDocRules {
  readonly renames: InstallRename[];
  readonly filters: string[];
  readonly generated: string[];
}

const RENAME_ROW = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*$/;
const BULLET_CODE = /^-\s+`([^`]+)`/;

/** The lines between a heading containing `heading` and the next heading. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("#") && line.includes(heading));
  if (start === -1) {
    throw new TemplateError(`workspace-template.md: no heading containing "${heading}"`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Bullets in a section, reduced to each bullet's first inline-code token. */
function bulletCodes(markdown: string, heading: string): string[] {
  return section(markdown, heading)
    .map((line) => BULLET_CODE.exec(line)?.[1])
    .filter((code): code is string => code !== undefined);
}

/**
 * Read the install rules back out of `docs/workspace-template.md`. The test
 * compares them against this module's exports so the prose CLI-002 reads and the
 * code it is checked against cannot say different things.
 */
export function parseContractDoc(markdown: string): ContractDocRules {
  const renames = section(markdown, "Renamed on copy")
    .map((line) => RENAME_ROW.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ template: match[1] ?? "", installed: match[2] ?? "" }));

  return {
    renames,
    filters: bulletCodes(markdown, "Filtered on copy"),
    generated: bulletCodes(markdown, "Generated by `corpus init`"),
  };
}

/** Read `docs/workspace-template.md` and parse its install rules. */
export function readContractDoc(docPath: string = CONTRACT_DOC_PATH): ContractDocRules {
  return parseContractDoc(readFileSync(docPath, "utf8"));
}

// --- Declared weight levels --------------------------------------------------
//
// AGENT-015, SPEC.md §7 and §11 (rider SHARED-022, signed 2026-08-06). A request
// may state the weight its work is done at, "choosing among the levels the skill
// itself defines" — so the orchestrate skill's tier table is not only prose a
// model reads, it is the **declaration** a composer enumerates to build its
// picker. One artefact, two readings — and both readings have to agree about
// what is prose and what is a fenced example, which is why this one carries a
// fence scanner of its own (see `fencedLines`).
//
// This reader is the repo's check on that declaration, not the product's parser
// — UI-082 owns that one, in `packages/kit`, over the same projected document —
// and both target the shape below and nothing looser. Guessing at prose is the
// failure this design exists to prevent: a reader that half-matches a reworded
// table would offer levels the router does not implement, which is exactly what
// §2.4 makes possible the day a workspace edits its own guidance.

/** One row of the orchestrate skill's declared level table. */
export interface WeightLevel {
  /** The **Weight** cell — the name a composer displays and a person picks by. */
  readonly name: string;
  /** The **Key** cell — the token that travels on a request's `weight` field. */
  readonly key: string;
  /** The **Model** cell, emphasis stripped. For the agent; no composer reads it. */
  readonly model: string;
}

/**
 * The header cells that identify the declaration, in order and spelled exactly.
 * Matching *cells* rather than the raw line is deliberate: the table is
 * prettier-formatted, so its padding is not stable and its text is.
 */
export const WEIGHT_TABLE_HEADER: readonly string[] = ["Weight", "Key", "Model", "What falls here"];

/** A markdown table row's trimmed cells, or `null` when the line is not one. */
const tableCells = (line: string): string[] | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
};

const isDividerRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/** A fence opener or closer: up to three leading spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Which lines sit inside a fenced code block.
 *
 * Deliberately a local scanner rather than the contract's `fencedCodeRanges`,
 * which is what the shipped parser in `packages/kit` uses. `scripts/` is repo
 * tooling and imports nothing out of a workspace's `dist/`, so this check on the
 * template can never be blocked on a build — the same direction the kit module's
 * docblock states when it declines to import *this* reader. The two therefore
 * agree by test rather than by construction: the shipped table is read by both
 * and pinned in `packages/kit/src/weight/weightLevels.test.ts`.
 *
 * An unterminated fence swallows the rest of the document, which is the honest
 * reading: a skill that opens a fence and never closes it declares nothing.
 */
const fencedLines = (lines: readonly string[]): ReadonlySet<number> => {
  const inside = new Set<number>();
  let open: string | null = null;
  for (const [index, line] of lines.entries()) {
    const match = FENCE_LINE.exec(line);
    if (open === null) {
      if (match === null) continue;
      const marker = match[1] ?? "";
      // A backtick fence's info string may not itself contain a backtick.
      if (marker.startsWith("`") && (match[2] ?? "").includes("`")) continue;
      open = marker;
      inside.add(index);
      continue;
    }
    inside.add(index);
    const marker = match?.[1] ?? "";
    const closes =
      match !== null &&
      marker[0] === open[0] &&
      marker.length >= open.length &&
      (match[2] ?? "").trim() === "";
    if (closes) open = null;
  }
  return inside;
};

/**
 * Enumerate the weight levels a skill body declares, in document order —
 * lightest first, which is the order a composer offers them in.
 *
 * Returns an **empty list** for anything that is not exactly the declared shape:
 * no header row spelled with {@link WEIGHT_TABLE_HEADER}, no divider under it, a
 * row with the wrong number of cells, or a row whose name or key is blank. That
 * is the whole degradation contract — a workspace whose skill declares nothing
 * parseable yields no levels, and its composer offers no control at all rather
 * than a fallback list, which would be the second source this design forbids.
 *
 * **A fenced example is not the declaration.** A skill that documents the format
 * with a worked example above its real table — which is what this repo's own
 * sources do when they explain the shape — must not have the example read as the
 * declaration, so lines inside a code fence are skipped entirely.
 */
export function readWeightLevels(markdown: string): WeightLevel[] {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  for (const [index, line] of lines.entries()) {
    if (fenced.has(index)) continue;
    const header = tableCells(line);
    if (header === null) continue;
    if (header.length !== WEIGHT_TABLE_HEADER.length) continue;
    if (!header.every((cell, position) => cell === WEIGHT_TABLE_HEADER[position])) continue;
    const divider = tableCells(lines[index + 1] ?? "");
    if (divider === null || !isDividerRow(divider)) continue;

    const levels: WeightLevel[] = [];
    for (const row of lines.slice(index + 2)) {
      const cells = tableCells(row);
      if (cells === null) break;
      if (cells.length !== WEIGHT_TABLE_HEADER.length) return [];
      const [name = "", key = "", model = ""] = cells;
      if (name === "" || key === "") return [];
      levels.push({ name, key, model: model.replaceAll("*", "").trim() });
    }
    return levels;
  }
  return [];
}

// --- CLI command references --------------------------------------------------
//
// Skill bodies are executable documentation: every `corpus …` invocation in the
// template tree must name a command the generated CLI reference documents. The
// extractor below pulls invocations out of template markdown (fenced blocks and
// inline code), normalizes each to `topic verb` (or a bare top-level command),
// and the test resolves them against `docs/cli.md` — so a CLI surface change
// that breaks an AGENT skill breaks the build, not a user's workspace.

export const CLI_DOC_PATH = path.join(REPO_ROOT, "docs", "cli.md");

/**
 * Commands the template may name that `docs/cli.md` does not document **yet**.
 *
 * **Empty, as designed.** Sprint-012 Adjudication 5 (Open Conflict 1) opened
 * this hole for exactly two verbs — `corpus doc check` and
 * `corpus skill rollback` — because the workspace README and the orchestrate
 * skill's loop-safety section had to document the recovery path before CLI-006
 * shipped it. The allowlist was **self-invalidating**: a companion test asserted
 * every entry was still absent from `docs/cli.md`, so the moment the verbs
 * landed the suite went red and the list had to be emptied. CLI-006 landed and
 * it was (sprint-013 Adjudication 17); the template's invocations now resolve
 * against the generated reference with no exemption at all.
 *
 * It stays here, empty, as the mechanism rather than as a leftover: a future
 * skill that has to name a verb before it exists gets one entry and the same
 * self-expiring test. Add nothing that is not in that position.
 */
export const CLI_COMMANDS_PENDING_CLI_006: readonly string[] = [];

export interface CliDocSurface {
  /** Invocable commands: bare (`init`) or `topic verb` (`queue idle`). */
  readonly commands: ReadonlySet<string>;
  /** Topic names (`queue`) — legal as bare references in prose. */
  readonly topics: ReadonlySet<string>;
  /** Flags each command declares, keyed by the same names as `commands`. */
  readonly flags: ReadonlyMap<string, ReadonlySet<string>>;
  /** Flags merged into every command by `docs/cli.md`'s _Global flags_ table. */
  readonly globalFlags: ReadonlySet<string>;
}

/** Every flag named in one markdown table row's **first** cell. */
function rowFlags(line: string): string[] {
  const firstCell = line.split("|")[1] ?? "";
  return [...firstCell.matchAll(/(?<![\w-])--?[A-Za-z][A-Za-z0-9-]*/g)].map((match) => match[0]);
}

/**
 * The flag table under one heading, read from **first cells only**.
 *
 * Descriptions name other flags constantly — `corpus doc patch`'s says there is
 * no `--key` — so scanning whole rows would document exactly the flags the
 * skills must not use. A flag exists here only where it is the row's subject.
 */
function flagsUnder(block: string): Set<string> {
  const flags = new Set<string>();
  for (const line of block.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const flag of rowFlags(line)) flags.add(flag);
  }
  return flags;
}

/** `docs/cli.md` split into its `## `/`### ` sections, heading line included. */
function sectionsOf(markdown: string): { readonly heading: string; readonly block: string }[] {
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    if (/^#{2,3} /.test(line)) {
      current = { heading: line, lines: [] };
      sections.push(current);
    } else current?.lines.push(line);
  }
  return sections.map(({ heading, lines }) => ({ heading, block: lines.join("\n") }));
}

/**
 * The documented command surface, read out of `docs/cli.md`'s headings. Every
 * command is a `## `/`### ` heading of the form `` `corpus <name>` ``; a
 * heading whose name prefixes deeper headings (`db` before `db doctor`) is a
 * topic rather than an invocable command.
 *
 * Each command's **flags** come from its own table, and the _Global flags_
 * section's table is merged into all of them — which is what lets a caller ask
 * not only whether a command exists but whether the flags a skill spells on it
 * do (AGENT-024: `corpus doc patch` takes no `--key`, and a skill that passed
 * one would teach a usage error the command extractor cannot see).
 */
export function parseCliDoc(markdown: string): CliDocSurface {
  const names = [...markdown.matchAll(/^#{2,3} `corpus ([^`]+)`/gm)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  if (names.length === 0) {
    throw new TemplateError("cli reference: no `corpus …` command headings found");
  }
  const topics = new Set(
    names.filter((name) => names.some((other) => other.startsWith(`${name} `))),
  );

  const flags = new Map<string, ReadonlySet<string>>();
  let globalFlags: ReadonlySet<string> = new Set();
  for (const { heading, block } of sectionsOf(markdown)) {
    if (/^#{2,3} Global flags\s*$/.test(heading)) {
      globalFlags = flagsUnder(block);
      continue;
    }
    const name = /^#{2,3} `corpus ([^`]+)`/.exec(heading)?.[1];
    if (name !== undefined) flags.set(name, flagsUnder(block));
  }
  if (globalFlags.size === 0) {
    throw new TemplateError("cli reference: no `Global flags` table found");
  }

  return {
    commands: new Set(names.filter((name) => !topics.has(name))),
    topics,
    flags,
    globalFlags,
  };
}

/** Read `docs/cli.md` and parse its command surface. */
export function readCliDoc(docPath: string = CLI_DOC_PATH): CliDocSurface {
  return parseCliDoc(readFileSync(docPath, "utf8"));
}

const HEREDOC_MARKER = /<<-?\s*'?([A-Za-z_][A-Za-z_0-9]*)'?/;

/** One quote-aware pass over a shell fragment. */
interface ShellScan {
  /** The fragment's `&&`/`||`/`|`/`;`-separated parts, split outside quotes only. */
  readonly segments: readonly string[];
  /** The quote character still open where the fragment ended, `null` when balanced. */
  readonly openQuote: string | null;
}

/**
 * Split a shell fragment into its separated commands, and say whether it ended
 * inside a quote.
 *
 * Both answers depend on quote state, which is why one pass produces them. A
 * separator inside a quoted value is that value's text — `--old '| a | b |'`
 * quotes a markdown table row in a corpus made of markdown, and splitting it
 * would truncate the invocation and leave every later flag unread. Scanning
 * stops at an unquoted ` # `, which is a trailing comment rather than argument.
 */
function scanShell(fragment: string): ShellScan {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = 0; index < fragment.length; index += 1) {
    const character = fragment[index] ?? "";
    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (
      character === "#" &&
      /\s/.test(fragment[index - 1] ?? "") &&
      /\s/.test(fragment[index + 1] ?? "")
    ) {
      break;
    }
    const pair = fragment.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    if (character === "|" || character === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  segments.push(current);
  return { segments, openQuote: quote };
}

/** Whether a scanned segment is a `corpus …` invocation. */
const isCorpusSegment = (segment: string): boolean =>
  segment.trim() === "corpus" || segment.trim().startsWith("corpus ");

/** An invocation's tokens after `corpus`, flags dropped, heredoc body cut. */
const invocationTokens = (invocation: string): string[] => {
  const command = invocation.split("<<")[0] ?? "";
  return command
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((token) => !token.startsWith("-"));
};

/**
 * An invocation's flags, in the order they were written and with any `=value`
 * dropped.
 *
 * A word is a flag only where the dash is the shell's and not the text's. Two
 * spellings decide that, and both are ordinary: a word whose quoting starts at
 * its first character is a quoted argument, so `--new '--all is not what I
 * meant'` spells one flag rather than two; a word that opens a quote partway
 * through is a flag carrying an attached value, so `--key='abc'` is `--key` —
 * the very flag this check exists to catch on a patch.
 */
const invocationFlags = (invocation: string): string[] => {
  const command = invocation.split("<<")[0] ?? "";
  const flags: string[] = [];
  let quote: string | null = null;
  let word = "";
  let quoted = false;

  const end = (): void => {
    if (word.startsWith("-") && !quoted) flags.push(word.split("=")[0] ?? word);
    word = "";
    quoted = false;
  };
  for (const character of command) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      if (word === "") quoted = true;
      continue;
    }
    if (/\s/.test(character)) end();
    else word += character;
  }
  end();
  return flags;
};

/** One `corpus …` invocation: the words after `corpus`, and the flags it spells. */
export interface CorpusInvocation {
  readonly tokens: readonly string[];
  readonly flags: readonly string[];
}

/**
 * Every `corpus …` invocation in a markdown document, with its tokens (the
 * words after `corpus`, flags dropped) and its flags. Two sources are scanned:
 * lines inside fenced code blocks, and inline code spans in prose. Heredoc
 * bodies inside fenced blocks are content, not commands, and are skipped up to
 * their terminator — a reply that merely mentions the word corpus at the start
 * of a line is never extracted. Prose outside code is never scanned.
 *
 * An invocation is a **logical** line: a patch quotes passages, and a quoted
 * value that opens on one line and closes on a later one is one command spread
 * over several. Those lines are joined before anything is read off them, so the
 * flags after the quote are checked like any others and a continuation line that
 * happens to begin with the word corpus is not mistaken for a second command.
 * Only a fragment that already holds a `corpus …` invocation joins, so an
 * apostrophe in prose or in output never swallows the lines below it.
 */
export function extractCorpusInvocationUses(markdown: string): CorpusInvocation[] {
  const invocations: CorpusInvocation[] = [];
  const proseLines: string[] = [];
  let inFence = false;
  let heredocTerminator: string | null = null;
  let pending: string | null = null;

  const record = (segments: readonly string[]): void => {
    for (const segment of segments.filter(isCorpusSegment)) {
      const invocation = segment.trim();
      invocations.push({
        tokens: invocationTokens(invocation),
        flags: invocationFlags(invocation),
      });
    }
  };

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (pending !== null) record(scanShell(pending).segments);
      pending = null;
      inFence = !inFence;
      heredocTerminator = null;
      continue;
    }
    if (!inFence) {
      proseLines.push(line);
      continue;
    }
    if (heredocTerminator !== null) {
      if (line.trim() === heredocTerminator) heredocTerminator = null;
      continue;
    }
    const logical: string = pending === null ? line : `${pending}\n${line}`;
    const { segments, openQuote } = scanShell(logical);
    if (openQuote !== null && segments.some(isCorpusSegment)) {
      pending = logical;
      continue;
    }
    pending = null;
    record(segments);
    heredocTerminator = HEREDOC_MARKER.exec(logical)?.[1] ?? null;
  }
  if (pending !== null) record(scanShell(pending).segments);

  for (const match of proseLines.join("\n").matchAll(/`([^`\n]+)`/g)) {
    const span = (match[1] ?? "").trim();
    if (span.startsWith("corpus ")) record(scanShell(span).segments);
  }
  return invocations;
}

/** Every `corpus …` invocation as token arrays alone, flags dropped. */
export function extractCorpusInvocations(markdown: string): string[][] {
  return extractCorpusInvocationUses(markdown).map((invocation) => [...invocation.tokens]);
}

/**
 * An invocation's normalized command: a bare top-level command (`init`), a
 * `topic verb` pair (`queue idle`), or a bare topic reference (`queue`).
 * `null` when the invocation carries only flags (`corpus --help`). Anything a
 * surface documents as a bare command keeps its arguments out of the name;
 * everything else resolves to its first two words, so an undocumented verb
 * (`doc frobnicate`) surfaces verbatim in the failure.
 */
export function normalizeInvocation(
  tokens: readonly string[],
  surface: CliDocSurface,
): string | null {
  const [first, second] = tokens;
  if (first === undefined) return null;
  if (surface.commands.has(first)) return first;
  return second === undefined ? first : `${first} ${second}`;
}
