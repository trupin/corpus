import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import { z } from "zod";

/**
 * The install contract for the bundled workspace template — **one**
 * implementation, shared by the two commands that need it: `corpus init`
 * installs from it, and `corpus workspace upgrade` compares against it.
 * `docs/workspace-template.md` is the prose contract and
 * `scripts/workspace-template.ts` the repo-side loader; this module is the third,
 * and `install.test.ts` proves all three agree path by path.
 *
 * The loader cannot simply be imported at runtime: `scripts/` lives outside the
 * npm workspaces (CLAUDE.md → Repository Structure) and ships in no tarball,
 * while `apps/cli`'s build has `src` as its `rootDir`. Duplicating two tables and
 * pinning them with a test is the honest version of "one contract" here — and it
 * is exactly **two** copies, not one per command.
 *
 * Neither command encodes knowledge of any individual seed file: both walk the
 * template, map each path through {@link installedPath}, and act on what comes
 * back. Adding a seed document therefore never requires editing the CLI.
 */

export interface InstallRename {
  /** Path inside `assets/workspace/`. A trailing `/` marks a directory prefix. */
  readonly template: string;
  /** Path inside the installed workspace. */
  readonly installed: string;
}

/**
 * Dot-prefixed names are stored dotless in the template so that this repository's
 * own Claude Code does not discover the *product's* skills as a dev-harness
 * skill, and so its `gitignore` does not apply to this repository. One rename at
 * install time buys both (docs/workspace-template.md → "Renamed on copy").
 */
export const INSTALL_RENAMES: readonly InstallRename[] = [
  { template: "claude/", installed: ".claude/" },
  { template: "gitignore", installed: ".gitignore" },
];

/**
 * `.gitkeep` exists only so this repository can track the template's empty
 * directories. `corpus init` creates those directories itself, so copying the
 * marker would litter every new workspace — and an upgrade must never compare
 * against a file that was deliberately never installed.
 */
export const INSTALL_FILTERS: readonly string[] = [".gitkeep"];

/** Every file in a template tree, `/`-separated and relative to its root, sorted. */
export function listTemplateFiles(root: string): readonly string[] {
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : [rel];
    });
  // Code-unit order, not `localeCompare`: the result drives a byte-for-byte
  // manifest and must not depend on the machine's locale.
  return walk(root, "").sort();
}

/**
 * Where a template file lands in an installed workspace, or `undefined` when the
 * copy filter drops it.
 */
export function installedPath(relPath: string): string | undefined {
  if (INSTALL_FILTERS.includes(path.posix.basename(relPath))) return undefined;
  for (const { template, installed } of INSTALL_RENAMES) {
    if (template.endsWith("/")) {
      if (relPath.startsWith(template)) return installed + relPath.slice(template.length);
    } else if (relPath === template) {
      return installed;
    }
  }
  return relPath;
}

export interface PlannedTemplateFile {
  /** Path relative to the template root. */
  readonly from: string;
  /** Path relative to the workspace root, after renames. */
  readonly to: string;
}

/** The whole copy step, as data: every surviving template file and its destination. */
export function planTemplateInstall(templateRoot: string): readonly PlannedTemplateFile[] {
  return listTemplateFiles(templateRoot).flatMap((from) => {
    const to = installedPath(from);
    return to === undefined ? [] : [{ from, to }];
  });
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
      return entry.isDirectory() ? walkFiles(path.join(dir, entry.name), rel) : [rel];
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
 *
 * `corpus workspace upgrade` calls this with the same reserved set, which is
 * what makes a `source: "plugin:<dir>"` manifest entry refreshable from the
 * plugin it came from rather than from the template.
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
    const skillsRoot = path.join(pluginsRoot, dir, "skills");
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
      for (const rel of walkFiles(path.join(skillsRoot, skill), "")) {
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

/** Where template documents live in a workspace (SPEC.md §11 — template pre-fill). */
export const WORKSPACE_TEMPLATES_DIR = "data/docs/templates";

/** The template file names the workspace template itself installs — the reserved set. */
export function templateSeedNames(installed: readonly PlannedTemplateFile[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of installed) {
    const match = new RegExp(`^${WORKSPACE_TEMPLATES_DIR}/([^/]+)$`).exec(file.to);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
}

/** One plugin seed template to install, both paths `/`-separated. */
export interface PlannedPluginSeedFile {
  /** The contributing plugin's directory name. */
  readonly plugin: string;
  /** Relative to the plugins root. */
  readonly from: string;
  /** Workspace-relative destination under `data/docs/templates/`. */
  readonly to: string;
}

export interface PluginSeedPlan {
  readonly files: readonly PlannedPluginSeedFile[];
  readonly warnings: readonly string[];
}

/**
 * The `types.yaml` shape this reader needs, mirroring
 * `apps/server/src/plugins/discover.ts`'s schema. It is deliberately the same
 * file with the same rules: a plugin declares its doc types once, and the
 * server routing them and the CLI installing their templates must not disagree
 * about what the declaration says.
 */
const TypesFileSchema = z.object({
  types: z.array(
    z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      seedTemplate: z.string().min(1).optional(),
    }),
  ),
});

/** `seedTemplate` paths declared by one plugin, in declaration order. */
function declaredSeedTemplates(
  pluginsRoot: string,
  dir: string,
  warnings: string[],
): readonly string[] {
  const typesPath = path.join(pluginsRoot, dir, "types.yaml");
  if (!existsSync(typesPath)) return [];

  let parsed;
  try {
    parsed = TypesFileSchema.safeParse(YAML.parse(readFileSync(typesPath, "utf8")));
  } catch (error) {
    warnings.push(
      `plugin ${dir} has an unreadable types.yaml, so its seed templates were not installed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
  if (!parsed.success) {
    warnings.push(
      `plugin ${dir} has a types.yaml that does not match the required shape ` +
        `(types: [{type, label, seedTemplate?}]), so its seed templates were not installed`,
    );
    return [];
  }
  return parsed.data.types.flatMap((declaration) =>
    declaration.seedTemplate === undefined ? [] : [declaration.seedTemplate],
  );
}

/** A declared path that would copy from outside the plugin's own directory. */
function escapesPlugin(declared: string): boolean {
  return (
    path.posix.isAbsolute(declared) ||
    path.isAbsolute(declared) ||
    declared.split(/[\\/]/).includes("..")
  );
}

/**
 * The plugin seed-template copy step, as data (SPEC.md §10 plugin assets, §11
 * template pre-fill). A plugin's `types.yaml` may declare
 * `seedTemplate: seeds/<file>.md` per doc type; the file lands beside the
 * workspace's own templates in `data/docs/templates/`, which is where the
 * projection indexes templates and where `corpus doc create --type <t>` looks
 * for the pre-fill. Before CLI-012 the declaration was shipped and never
 * installed.
 *
 * The rules mirror {@link planPluginSkillInstall} one for one, because the two
 * are the same problem — a plugin contributing a file to a workspace directory
 * core also owns:
 *
 * - **Opt-in by declaration.** A plugin that declares no `seedTemplate`
 *   installs nothing, whatever is sitting in its `seeds/` directory.
 * - **Core wins.** A file name colliding with one the workspace template itself
 *   installs (`note.md`) is skipped with a warning.
 * - **First plugin in directory order wins** a collision between two plugins;
 *   the loser is a warning, never a silent overwrite.
 * - **A declared-but-missing file is a warning naming the plugin and the path**,
 *   not a silent skip and not a manifest entry for a file that is not there.
 */
export function planPluginSeedInstall(
  pluginsRoot: string | undefined,
  reservedTemplates: ReadonlySet<string>,
): PluginSeedPlan {
  if (pluginsRoot === undefined || !existsSync(pluginsRoot)) return { files: [], warnings: [] };

  const files: PlannedPluginSeedFile[] = [];
  const warnings: string[] = [];
  const claimed = new Map<string, string>();

  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs) {
    for (const declared of declaredSeedTemplates(pluginsRoot, dir, warnings)) {
      if (escapesPlugin(declared)) {
        warnings.push(
          `plugin ${dir} declares seedTemplate "${declared}", which points outside the plugin ` +
            "directory — skipped",
        );
        continue;
      }
      const from = `${dir}/${declared.split(path.sep).join("/")}`;
      if (!existsSync(path.join(pluginsRoot, ...from.split("/")))) {
        warnings.push(
          `plugin ${dir} declares seedTemplate "${declared}", which does not exist — skipped; ` +
            "no template was installed for it",
        );
        continue;
      }

      const name = path.posix.basename(from);
      if (reservedTemplates.has(name)) {
        warnings.push(
          `plugin ${dir} ships a seed template named "${name}", which collides with a workspace ` +
            `template document — skipped; a plugin can never replace a core template`,
        );
        continue;
      }
      const holder = claimed.get(name);
      if (holder !== undefined) {
        warnings.push(
          `plugin ${dir} ships a seed template named "${name}", already installed by plugin ` +
            `${holder} — skipped`,
        );
        continue;
      }
      claimed.set(name, dir);
      files.push({ plugin: dir, from, to: `${WORKSPACE_TEMPLATES_DIR}/${name}` });
    }
  }

  return { files, warnings };
}
