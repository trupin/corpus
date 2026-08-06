import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePluginsRoot, resolveTemplateRoot } from "../paths.js";
import {
  planPluginSeedInstall,
  planPluginSkillInstall,
  planTemplateInstall,
  templateSeedNames,
  templateSkillNames,
} from "./install.js";
import { pluginSourceMarker, sha256 } from "./manifest.js";
import type { IncomingFile } from "./plan.js";

/**
 * "What would the installed tool put in a workspace today, and what does the
 * workspace have instead" — the two sides of the three-way compare that are read
 * rather than recorded (SPEC.md §2.1, §2.4).
 *
 * It lives here rather than inside `corpus workspace upgrade` because a second
 * verb needs the same answer: `corpus workspace diff` shows what an upgrade
 * refused to overwrite, and two spellings of "the tool's copy of this path" is
 * exactly the drift the three-way logic exists to prevent — a diff computed
 * against a differently-derived source would contradict the verdict that sent
 * the reader here.
 */

/**
 * The tool-side roots, named so tests can point them at a scratch tree.
 * Simulating "the operator ran `npm update`" means changing what the *tool*
 * carries, which is otherwise fixed by the installed package's own layout.
 */
export interface ToolRoots {
  readonly templateRoot?: string;
  readonly pluginsRoot?: string | undefined;
}

/**
 * Every file the installed tool would put in a workspace today, hashed: the
 * bundled template, then the plugin skills, each carrying where it came from.
 * A plugin-sourced entry is refreshed from **its plugin**, not from the template
 * (sprint-012 Adjudication 11) — which falls out of building the source set the
 * same way `corpus init` does, rather than by special-casing the manifest marker.
 */
export function collectIncoming(roots: ToolRoots = {}): readonly IncomingFile[] {
  const templateRoot = roots.templateRoot ?? resolveTemplateRoot();
  const installed = planTemplateInstall(templateRoot);

  const files: IncomingFile[] = installed.map((file) => {
    const from = join(templateRoot, ...file.from.split("/"));
    return { path: file.to, from, sha256: sha256(readFileSync(from)) };
  });

  const pluginsRoot = "pluginsRoot" in roots ? roots.pluginsRoot : resolvePluginsRoot();
  const pluginFiles = [
    ...planPluginSkillInstall(pluginsRoot, templateSkillNames(installed)).files,
    // Seed templates ride the same path as skills (CLI-012), which is what makes
    // an installed plugin template refreshable from its plugin and protected by
    // the same never-clobber compare — no special case anywhere.
    ...planPluginSeedInstall(pluginsRoot, templateSeedNames(installed)).files,
  ];
  for (const file of pluginFiles) {
    const from = join(pluginsRoot ?? "", ...file.from.split("/"));
    files.push({
      path: file.to,
      from,
      sha256: sha256(readFileSync(from)),
      source: pluginSourceMarker(file.plugin),
    });
  }
  return files;
}

/** A workspace-relative POSIX path as an absolute one on this platform. */
export function workspaceFilePath(root: string, path: string): string {
  return join(root, ...path.split("/"));
}

/** The sha of the workspace's copy, or `null` when it is not there. */
export function shaOnDisk(root: string, path: string): string | null {
  const absolute = workspaceFilePath(root, path);
  return existsSync(absolute) ? sha256(readFileSync(absolute)) : null;
}
