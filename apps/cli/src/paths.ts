import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { InternalError } from "./errors.js";
import { cliPackageRoot } from "./version.js";
import { CONFIG_DIR } from "./workspace.js";

/**
 * Where things live, on both sides of the tool/workspace split (CLAUDE.md
 * Architecture Decision 1).
 *
 * *Inside a workspace* the CLI owns exactly two files — the pidfile and the
 * logfile `corpus server start|stop` manage (SPEC.md §2.2 rule 4) — plus
 * whatever `corpus init` creates once. Naming them here rather than inline keeps
 * the two commands that write them and the docs that describe them in agreement.
 *
 * *Inside the tool* the bundled workspace template has to be found relative to
 * the installed package, never relative to the operator's cwd: `corpus init` in
 * `/tmp/notes` must still copy the template out of wherever npm put `@corpus/cli`.
 */

export const SERVER_PIDFILE = "server.pid";
export const SERVER_LOGFILE = "server.log";
export const TEMPLATE_MANIFEST_FILE = "template-manifest.json";

/** `<root>/.corpus`. */
export function corpusDir(root: string): string {
  return join(root, CONFIG_DIR);
}

export function serverPidfilePath(root: string): string {
  return join(corpusDir(root), SERVER_PIDFILE);
}

export function serverLogPath(root: string): string {
  return join(corpusDir(root), SERVER_LOGFILE);
}

export function templateManifestPath(root: string): string {
  return join(corpusDir(root), TEMPLATE_MANIFEST_FILE);
}

/**
 * The template sits at the *repo* root (`<repo>/assets/workspace`) but ships
 * inside the `@corpus/cli` tarball, so two layouts have to work. Mirrors
 * `resolveUiDistDir` in `apps/server/src/config.ts` — packaged first, dev second.
 *
 * Staging `assets/` into `apps/cli/` at pack time (and adding it to the package's
 * `files`) is INFRA-008's half of this; sprint-003 Open Conflict 11 defers the
 * `npm pack` proof there and pins the dev layout as this sprint's path.
 */
export function templateRootCandidates(packageRoot: string = cliPackageRoot()): readonly string[] {
  return [
    join(packageRoot, "assets", "workspace"),
    resolve(packageRoot, "..", "..", "assets", "workspace"),
  ];
}

/**
 * The bundled `assets/workspace/` directory, or a failure naming every place
 * that was looked at — a broken install must say which path it expected rather
 * than "ENOENT" from somewhere inside the copy.
 */
export function resolveTemplateRoot(packageRoot: string = cliPackageRoot()): string {
  const candidates = templateRootCandidates(packageRoot);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new InternalError("the bundled workspace template is missing from this installation", {
      hint: "Reinstall the `corpus` tool; the template ships inside the package.",
      details: { searched: candidates },
    });
  }
  return found;
}
