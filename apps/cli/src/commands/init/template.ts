import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * The install contract for the bundled workspace template, as `corpus init`
 * executes it. `docs/workspace-template.md` is the prose contract and
 * `scripts/workspace-template.ts` the repo-side loader; this module is the third
 * implementation, and `template.test.ts` proves all three agree path by path.
 *
 * The loader cannot simply be imported at runtime: `scripts/` lives outside the
 * npm workspaces (CLAUDE.md → Repository Structure) and ships in no tarball,
 * while `apps/cli`'s build has `src` as its `rootDir`. Duplicating two tables and
 * pinning them with a test is the honest version of "one contract" here.
 *
 * `corpus init` encodes no knowledge of any individual seed file: it walks the
 * template, maps each path through {@link installedPath}, and writes what comes
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
 * marker would litter every new workspace.
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
