import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { QUEUE_EVENT_STATUSES, type QueueEventStatus } from "@corpus/contract";
import { templateManifestPath } from "../../paths.js";
import {
  planPluginSeedInstall,
  planPluginSkillInstall,
  planTemplateInstall,
  templateSeedNames,
  templateSkillNames,
  type PlannedTemplateFile,
} from "../../template/install.js";
import {
  pluginSourceMarker,
  serializeManifest,
  sha256,
  type ManifestEntry,
  type TemplateManifest,
} from "../../template/manifest.js";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_DATA_DIR } from "../../workspace.js";
import { enclosingRepositoryRoot } from "./git.js";

/**
 * Materializing a workspace on disk (SPEC.md §4). Everything here is synchronous
 * and ordered so that a failure at any step can be unwound: `corpus init` must
 * never leave a half-workspace that a second `corpus init` then refuses to fix.
 */

/** Bytes of CSPRNG entropy behind the workspace bearer token (SPEC.md §2.1). */
export const TOKEN_BYTES = 32;

/**
 * The queue's status directories, derived from the contract's enum rather than
 * re-listed here. A local copy is how CONTRACT-021's `deferred` reached the
 * server without reaching a fresh workspace: nothing in the type system relates
 * a string literal array to the wire enum, so the divergence compiled silently
 * and would have shipped a workspace missing `.corpus/queue/deferred/`. Reading
 * the contract means the next status is created by `corpus init` the day it is
 * declared.
 */
const QUEUE_STATUSES: readonly QueueEventStatus[] = QUEUE_EVENT_STATUSES;

/**
 * Every directory a fresh workspace has, whether or not anything is copied into
 * it. Three of them exist purely so the server's document roots (SPEC.md §4,
 * §7) are real in a day-one workspace: `.claude/skills-archived/` is where
 * `corpus doc archive` moves a skill, and `.claude/agents/` is where subagent
 * personas land. `data/docs/inbox/` and `data/threads/` stay untracked while
 * empty — only the queue skeleton survives a clone (sprint-003 Open Conflict 9).
 */
export const WORKSPACE_DIRECTORIES: readonly string[] = [
  "data",
  "data/docs",
  "data/docs/inbox",
  "data/docs/templates",
  "data/docs/views",
  "data/threads",
  ".claude",
  ".claude/skills",
  ".claude/skills-archived",
  ".claude/agents",
  CONFIG_DIR,
  `${CONFIG_DIR}/queue`,
  ...QUEUE_STATUSES.map((status) => `${CONFIG_DIR}/queue/${status}`),
  // No `locks/`: SPEC.md §7's key is derived from a document's content, so there
  // is nothing to store, nothing to reap, and no directory for a crashed session
  // to leave a wedged file in (SHARED-041).
  `${CONFIG_DIR}/jobs`,
  `${CONFIG_DIR}/attachments`,
];

/** Mode `0600`: the config holds the bearer token (SPEC.md §2.1). */
export const CONFIG_MODE = 0o600;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export interface CreatedEntry {
  readonly path: string;
  /**
   * `directory` unwinds only when empty; `tree` unwinds recursively and is used
   * for a directory this run owns outright, such as a `.git` it created.
   */
  readonly kind: "file" | "directory" | "tree";
}

/**
 * Exactly what this run created, in creation order, so a failure can put the
 * target back the way it was found. Tracking paths individually rather than
 * deleting the target wholesale matters: `corpus init` may run in a directory
 * that already holds the operator's `.git/` or their own `.claude/`, and
 * unwinding must not take those with it.
 */
export class CreatedPaths {
  readonly #entries: CreatedEntry[] = [];
  readonly #overwritten: string[] = [];

  get entries(): readonly CreatedEntry[] {
    return this.#entries;
  }

  /**
   * Paths that already existed and were written over. Recorded, never
   * recoverable: {@link unwind} deletes what this run created and has no
   * snapshot of what it replaced, so an overwritten `README.md` is gone
   * (CLI-013 — the failure mode behind three destructive incidents). `runInit`
   * refuses before the first write precisely so this list stays empty; it exists
   * so that `--force`, which opts into the damage, can name what it did.
   */
  get overwritten(): readonly string[] {
    return this.#overwritten;
  }

  record(path: string, kind: CreatedEntry["kind"]): void {
    this.#entries.push({ path, kind });
  }

  /** `mkdir -p`, recording only the segments that did not already exist. */
  mkdir(path: string): void {
    const missing: string[] = [];
    for (let current = resolve(path); !existsSync(current); current = dirname(current)) {
      missing.unshift(current);
      if (dirname(current) === current) break;
    }
    if (missing.length === 0) return;
    mkdirSync(path, { recursive: true });
    for (const created of missing) this.record(created, "directory");
  }

  writeFile(path: string, contents: string | Uint8Array, mode?: number): void {
    this.mkdir(dirname(path));
    const existed = existsSync(path);
    writeFileSync(path, contents, mode === undefined ? undefined : { mode });
    // `mode` on write is subject to umask; the token file's 0600 is not a hint.
    if (mode !== undefined) chmodSync(path, mode);
    if (existed) this.#overwritten.push(path);
    else this.record(path, "file");
  }

  copyFile(from: string, to: string): void {
    this.mkdir(dirname(to));
    const existed = existsSync(to);
    copyFileSync(from, to);
    if (existed) this.#overwritten.push(to);
    else this.record(to, "file");
  }

  /**
   * Removes what this run created, newest first. Directories are removed only
   * when empty, so anything the operator put there survives; failures are
   * swallowed because unwinding runs while another error is already being
   * reported and must not replace it.
   */
  unwind(): void {
    for (const entry of [...this.#entries].reverse()) {
      try {
        if (entry.kind === "file") {
          rmSync(entry.path, { force: true });
        } else if (entry.kind === "tree") {
          rmSync(entry.path, { recursive: true, force: true });
        } else {
          // Non-recursive on purpose: a directory the operator has since put
          // something into is theirs now, and `rmdir` refusing is the guard.
          rmdirSync(entry.path);
        }
      } catch {
        // Best effort: a directory the operator has since filled stays.
      }
    }
    this.#entries.length = 0;
  }
}

export interface WorkspaceConfigFile {
  readonly version: 1;
  readonly port: number;
  readonly token: string;
  readonly dataDir: string;
}

export function buildConfig(port: number, token: string): WorkspaceConfigFile {
  return { version: 1, port, token, dataDir: DEFAULT_DATA_DIR };
}

export interface ScaffoldOptions {
  readonly root: string;
  readonly templateRoot: string;
  /**
   * The tool's bundled `plugins/` directory, or `undefined` for none. Plugin
   * skills (`plugins/<dir>/skills/*`) install into `.claude/skills/` beside
   * the template's own (SPEC.md §10); a missing root installs nothing.
   */
  readonly pluginsRoot?: string | undefined;
  readonly port: number;
  readonly token: string;
  readonly toolVersion: string;
  readonly now?: Date;
  readonly created?: CreatedPaths;
}

export interface ScaffoldResult {
  readonly created: CreatedPaths;
  readonly installed: readonly PlannedTemplateFile[];
  /** Plugin skill files installed, workspace-relative. */
  readonly installedPluginSkills: readonly string[];
  /** Plugin seed templates installed, workspace-relative (SPEC.md §10, §11). */
  readonly installedPluginSeeds: readonly string[];
  /** Skipped plugin assets (name collisions, missing declarations) — surfaced by `corpus init`. */
  readonly pluginWarnings: readonly string[];
  readonly manifest: TemplateManifest;
  readonly configPath: string;
}

/**
 * Directory tree → template copy → config → queue skeleton → manifest. The
 * config is written before the template so that a failure mid-copy still leaves
 * a target the caller's unwind recognises; the git repository is the caller's
 * next step, not this function's, because an existing repository is reused.
 */
export function scaffoldWorkspace(options: ScaffoldOptions): ScaffoldResult {
  const created = options.created ?? new CreatedPaths();
  const { root, templateRoot } = options;

  for (const relative of WORKSPACE_DIRECTORIES) {
    created.mkdir(join(root, ...relative.split("/")));
  }

  const installed = planTemplateInstall(templateRoot);
  const files: ManifestEntry[] = [];
  for (const file of installed) {
    const source = join(templateRoot, ...file.from.split("/"));
    created.copyFile(source, join(root, ...file.to.split("/")));
    files.push({ path: file.to, sha256: sha256(readFileSync(source)) });
  }

  // Plugin skills, after the template so the reserved-name rule is computed
  // from what was actually installed. Entries land in the same manifest with a
  // `source: "plugin:<dir>"` marker (sprint-012 Adjudication 11) so
  // `corpus workspace upgrade` can tell the two provenances apart.
  const pluginSkills = planPluginSkillInstall(options.pluginsRoot, templateSkillNames(installed));
  // Plugin seed templates (CLI-012): a second asset kind through the same path
  // — declared in the plugin's `types.yaml`, installed beside the workspace's
  // own templates, and marked with the same `plugin:<dir>` provenance so an
  // upgrade refreshes it from its plugin under CLI-005's never-clobber rules.
  const pluginSeeds = planPluginSeedInstall(options.pluginsRoot, templateSeedNames(installed));
  for (const file of [...pluginSkills.files, ...pluginSeeds.files]) {
    const source = join(options.pluginsRoot ?? "", ...file.from.split("/"));
    created.copyFile(source, join(root, ...file.to.split("/")));
    files.push({
      path: file.to,
      sha256: sha256(readFileSync(source)),
      source: pluginSourceMarker(file.plugin),
    });
  }

  const configPath = join(root, CONFIG_DIR, CONFIG_FILE);
  created.writeFile(
    configPath,
    `${JSON.stringify(buildConfig(options.port, options.token), null, 2)}\n`,
    CONFIG_MODE,
  );

  // The `.gitkeep`s the template's own `.gitignore` negation is built around:
  // `.corpus/*` hides the runtime tree, `!.corpus/queue/` lets the status
  // directories through, and these markers are what git actually tracks — so a
  // clone of the workspace arrives with the skeleton already present. The count
  // is `QUEUE_STATUSES`'s and is deliberately not written down here: naming it
  // "five" is what went stale when CONTRACT-021 added `deferred`, in the very
  // comment explaining the mechanism that was supposed to prevent that.
  for (const status of QUEUE_STATUSES) {
    created.writeFile(join(root, CONFIG_DIR, "queue", status, ".gitkeep"), "");
  }

  const manifest: TemplateManifest = {
    version: 1,
    tool: options.toolVersion,
    installedAt: (options.now ?? new Date()).toISOString(),
    files,
  };
  created.writeFile(templateManifestPath(root), serializeManifest(manifest));

  return {
    created,
    installed,
    installedPluginSkills: pluginSkills.files.map((file) => file.to),
    installedPluginSeeds: pluginSeeds.files.map((file) => file.to),
    pluginWarnings: [...pluginSkills.warnings, ...pluginSeeds.warnings],
    manifest,
    configPath,
  };
}

/**
 * Whether a directory already holds a workspace. Both halves matter: a
 * `.corpus/config.json` is the definitive marker, and a non-empty `data/` means
 * documents are already here even if the runtime tree was deleted — writing a
 * fresh config over either would orphan a token or a corpus.
 */
export function existingWorkspaceReason(root: string): string | undefined {
  if (existsSync(join(root, CONFIG_DIR, CONFIG_FILE))) {
    return `${CONFIG_DIR}${sep}${CONFIG_FILE} already exists`;
  }
  const dataDir = join(root, DEFAULT_DATA_DIR);
  if (existsSync(dataDir) && statSync(dataDir).isDirectory() && !isEmptyDirectory(dataDir)) {
    return `${DEFAULT_DATA_DIR}${sep} already contains documents`;
  }
  return undefined;
}

function isEmptyDirectory(dir: string): boolean {
  return readdirSync(dir).length === 0;
}

/** How many pre-existing entries a refusal names before summarising the rest. */
const NAMED_ENTRY_LIMIT = 5;

/**
 * Evidence that the target belongs to somebody else, gathered before anything is
 * written. `corpus init` copies the template over same-named files and commits
 * whatever it finds, and {@link CreatedPaths.unwind} cannot restore an overwrite
 * — so refusing up front is the only safe shape (CLI-013).
 *
 * The three hazards stay distinct because they are three different accidents: a
 * repository *at* the target means init commits into it, a repository *above* it
 * means init creates a nested repository inside somebody's checkout, and
 * pre-existing entries mean files are clobbered. An enclosing **Corpus
 * workspace** is deliberately not evidence: nesting a workspace inside a
 * workspace is confusing rather than destructive and stays the warning it
 * already is (sprint-015 Adjudication 8).
 */
export function unrelatedContentReasons(target: string): readonly string[] {
  const reasons: string[] = [];
  const root = resolve(target);

  if (existsSync(root)) {
    const gitPath = join(root, ".git");
    if (existsSync(gitPath)) {
      reasons.push(
        statSync(gitPath).isDirectory()
          ? "it is a git repository (.git/)"
          : "it is a linked git worktree of another repository (.git file)",
      );
    }
    const entries = readdirSync(root).sort();
    if (entries.length > 0) reasons.push(describeEntries(entries));
  }

  const enclosing = enclosingRepositoryRoot(dirname(root));
  if (enclosing !== undefined && !existsSync(join(enclosing, CONFIG_DIR, CONFIG_FILE))) {
    reasons.push(`it sits inside the git repository at ${enclosing}`);
  }
  return reasons;
}

function describeEntries(entries: readonly string[]): string {
  const shown = entries.slice(0, NAMED_ENTRY_LIMIT);
  const rest = entries.length - shown.length;
  const names = rest === 0 ? shown.join(", ") : `${shown.join(", ")}, and ${String(rest)} more`;
  return `it already holds ${String(entries.length)} entr${
    entries.length === 1 ? "y" : "ies"
  } (${names})`;
}
