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

/**
 * Where `corpus upgrade` writes its report (SPEC.md §2.4, CONTRACT-027's
 * `UpgradeStarted.logPath`).
 *
 * A third CLI-owned file inside `.corpus/`, and it exists for the same reason
 * the other two do: the process that produces this information cannot hand it
 * back over the channel that asked for it. An upgrade triggered from the UI runs
 * detached and its last act is restarting the very server the browser was
 * talking to, so the connection carrying the request is gone long before the
 * report exists. The file is the only place the answer — what was installed,
 * what the template sync updated, and above all which files are left in conflict
 * — can still be read afterwards.
 */
export const UPGRADE_LOGFILE = "upgrade.log";

/** How the report's location is spelled to a client: workspace-relative, POSIX. */
export const UPGRADE_LOG_RELATIVE_PATH = `${CONFIG_DIR}/${UPGRADE_LOGFILE}`;

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

export function upgradeLogPath(root: string): string {
  return join(corpusDir(root), UPGRADE_LOGFILE);
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
