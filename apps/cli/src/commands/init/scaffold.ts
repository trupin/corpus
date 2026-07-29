import { randomBytes, createHash } from "node:crypto";
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
import { templateManifestPath } from "../../paths.js";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_DATA_DIR } from "../../workspace.js";
import { planTemplateInstall, type PlannedTemplateFile } from "./template.js";

/**
 * Materializing a workspace on disk (SPEC.md §4). Everything here is synchronous
 * and ordered so that a failure at any step can be unwound: `corpus init` must
 * never leave a half-workspace that a second `corpus init` then refuses to fix.
 */

/** Bytes of CSPRNG entropy behind the workspace bearer token (SPEC.md §2.1). */
export const TOKEN_BYTES = 32;

export const QUEUE_STATUSES = [
  "pending",
  "in-progress",
  "processed",
  "failed",
  "abandoned",
] as const;

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
  `${CONFIG_DIR}/locks`,
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

  get entries(): readonly CreatedEntry[] {
    return this.#entries;
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
    if (!existed) this.record(path, "file");
  }

  copyFile(from: string, to: string): void {
    this.mkdir(dirname(to));
    const existed = existsSync(to);
    copyFileSync(from, to);
    if (!existed) this.record(to, "file");
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

export interface ManifestEntry {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  readonly sha256: string;
  /**
   * Where the file came from when not the workspace template:
   * `"plugin:<dir>"` for a plugin-installed skill (sprint-012 Adjudication
   * 11), so `corpus workspace upgrade` (CLI-005) can refresh it from the
   * plugin rather than the template. Absent ⇒ template — the original entry
   * shape is unchanged.
   */
  readonly source?: string;
}

/**
 * What `corpus init` installed, so `corpus workspace upgrade` (CLI-005) can
 * three-way compare against the *original* bytes later. It is worthless if
 * written later — nothing can retroactively learn what the first install
 * contained (SPEC.md §2.1, sprint-003 Open Conflict 10).
 */
export interface TemplateManifest {
  readonly version: 1;
  readonly tool: string;
  readonly installedAt: string;
  readonly files: readonly ManifestEntry[];
}

export function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
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
  /** Skipped plugin skills (name collisions) — surfaced by `corpus init`. */
  readonly pluginWarnings: readonly string[];
  readonly manifest: TemplateManifest;
  readonly configPath: string;
}

/** One plugin skill file to install, both paths `/`-separated. */
export interface PlannedPluginSkillFile {
  /** The contributing plugin's directory name. */
  readonly plugin: string;
  /** Relative to the plugins root. */
  readonly from: string;
  /** Workspace-relative destination under `.claude/skills/`. */
  readonly to: string;
}

export interface PluginSkillPlan {
  readonly files: readonly PlannedPluginSkillFile[];
  readonly warnings: readonly string[];
}

function walkFiles(dir: string, prefix: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? walkFiles(join(dir, entry.name), rel) : [rel];
    })
    .sort();
}

/**
 * The plugin-skills copy step, as data (SPEC.md §10: plugin skills are
 * "installed into the workspace's `.claude/skills/`"). Rules, in order:
 *
 * - A skill whose directory name collides with a **template** skill
 *   (`orchestrate`, `comment`, …) is skipped with a warning naming the
 *   collision — core wins, always: a plugin can never replace the loop
 *   (sprint-012 Adjudication 11).
 * - Two plugins shipping the same skill name: the first in directory order
 *   wins; the loser is a warning, never a silent overwrite.
 * - Underscore-prefixed plugins install like any other: `corpus init` from a
 *   dev checkout is the dev flow, and the packaged tool ships no fixtures.
 */
export function planPluginSkillInstall(
  pluginsRoot: string | undefined,
  reservedSkills: ReadonlySet<string>,
): PluginSkillPlan {
  if (pluginsRoot === undefined || !existsSync(pluginsRoot)) return { files: [], warnings: [] };

  const files: PlannedPluginSkillFile[] = [];
  const warnings: string[] = [];
  const claimed = new Map<string, string>();

  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs) {
    const skillsRoot = join(pluginsRoot, dir, "skills");
    if (!existsSync(skillsRoot)) continue;
    const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const skill of skillNames) {
      if (reservedSkills.has(skill)) {
        warnings.push(
          `plugin ${dir} ships a skill named "${skill}", which collides with a workspace ` +
            `template skill — skipped; a plugin can never replace a core skill`,
        );
        continue;
      }
      const holder = claimed.get(skill);
      if (holder !== undefined) {
        warnings.push(
          `plugin ${dir} ships a skill named "${skill}", already installed by plugin ` +
            `${holder} — skipped`,
        );
        continue;
      }
      claimed.set(skill, dir);
      for (const rel of walkFiles(join(skillsRoot, skill), "")) {
        files.push({
          plugin: dir,
          from: `${dir}/skills/${skill}/${rel}`,
          to: `.claude/skills/${skill}/${rel}`,
        });
      }
    }
  }

  return { files, warnings };
}

/** The skill directory names the template itself installs — the reserved set. */
export function templateSkillNames(installed: readonly PlannedTemplateFile[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of installed) {
    const match = /^\.claude\/skills\/([^/]+)\//.exec(file.to);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
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
  for (const file of pluginSkills.files) {
    const source = join(options.pluginsRoot ?? "", ...file.from.split("/"));
    created.copyFile(source, join(root, ...file.to.split("/")));
    files.push({
      path: file.to,
      sha256: sha256(readFileSync(source)),
      source: `plugin:${file.plugin}`,
    });
  }

  const configPath = join(root, CONFIG_DIR, CONFIG_FILE);
  created.writeFile(
    configPath,
    `${JSON.stringify(buildConfig(options.port, options.token), null, 2)}\n`,
    CONFIG_MODE,
  );

  // The `.gitkeep`s the template's own `.gitignore` negation is built around:
  // `.corpus/*` hides the runtime tree, `!.corpus/queue/` lets the five status
  // directories through, and these markers are what git actually tracks — so a
  // clone of the workspace arrives with the skeleton already present.
  for (const status of QUEUE_STATUSES) {
    created.writeFile(join(root, CONFIG_DIR, "queue", status, ".gitkeep"), "");
  }

  const manifest: TemplateManifest = {
    version: 1,
    tool: options.toolVersion,
    installedAt: (options.now ?? new Date()).toISOString(),
    files,
  };
  created.writeFile(templateManifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    created,
    installed,
    installedPluginSkills: pluginSkills.files.map((file) => file.to),
    pluginWarnings: pluginSkills.warnings,
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
