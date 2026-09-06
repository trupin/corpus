import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTemplateRoot } from "../paths.js";
import { normalizedSha256 } from "./ignored-keys.js";
import { planTemplateInstall } from "./install.js";
import { sha256 } from "./manifest.js";
import type { ContentShas, IncomingFile } from "./plan.js";

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
 * The tool-side root, named so tests can point it at a scratch tree. Simulating
 * "the operator ran `npm update`" means changing what the *tool* carries, which
 * is otherwise fixed by the installed package's own layout.
 */
export interface ToolRoots {
  readonly templateRoot?: string;
}

/**
 * Every file the installed tool would put in a workspace today, hashed. A path
 * the manifest knows and this set does not is `retired` by `planUpgrade` — the
 * workspace keeps its copy and only the manifest entry is dropped — which is
 * also how a file an older tool installed from a source this build no longer
 * carries is left alone rather than deleted.
 */
export function collectIncoming(roots: ToolRoots = {}): readonly IncomingFile[] {
  const templateRoot = roots.templateRoot ?? resolveTemplateRoot();
  return planTemplateInstall(templateRoot).map((file) => {
    const from = join(templateRoot, ...file.from.split("/"));
    return { path: file.to, from, ...contentShas(readFileSync(from)) };
  });
}

/** A workspace-relative POSIX path as an absolute one on this platform. */
export function workspaceFilePath(root: string, path: string): string {
  return join(root, ...path.split("/"));
}

/** Both identities of the workspace's copy, or `null` when it is not there. */
export function shasOnDisk(root: string, path: string): ContentShas | null {
  const absolute = workspaceFilePath(root, path);
  return existsSync(absolute) ? contentShas(readFileSync(absolute)) : null;
}

/**
 * The raw sha and the ignored-keys-normalized sha of one file, always computed
 * together: every consumer of one side of the compare needs both, and a copy
 * hashed one way but not the other is how the two comparisons would drift.
 */
function contentShas(contents: Buffer): ContentShas {
  return { sha256: sha256(contents), normalizedSha256: normalizedSha256(contents) };
}
