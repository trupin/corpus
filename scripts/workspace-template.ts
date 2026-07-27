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
  ".corpus/locks/",
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
