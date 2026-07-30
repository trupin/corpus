/**
 * `npm run version:check` — the version-singularity gate (INFRA-008).
 *
 * Runs in `.githooks/pre-push` (cheap, catches drift long before a tag exists),
 * in `CI / validate`, and in the release workflow, where `GITHUB_REF` also makes
 * it the tag/version guard: a `v1.2.3` tag against a `1.2.4` manifest fails here
 * rather than half-publishing.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { checkVersions, type ManifestVersion } from "./versions.js";

const repoRoot = resolve(import.meta.dirname, "..");

const ManifestSchema = z.looseObject({
  version: z.string().min(1).optional(),
  workspaces: z.array(z.string()).optional(),
});

function readManifest(absolutePath: string, displayPath: string): ManifestVersion {
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  return { path: displayPath, version: ManifestSchema.parse(parsed).version };
}

/**
 * Expands the root manifest's `workspaces` globs. They are all one level deep
 * (`apps/*`, `packages/*`, `plugins/*`), so a directory listing is the whole
 * story — reading them from the manifest rather than hard-coding them means a
 * new workspace joins the check by existing.
 */
function workspaceManifestPaths(): readonly string[] {
  const rootManifest: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const globs = ManifestSchema.parse(rootManifest).workspaces ?? [];
  const found: string[] = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*")) {
      const direct = join(glob, "package.json");
      if (existsSync(join(repoRoot, direct))) found.push(direct);
      continue;
    }
    const parent = glob.slice(0, -2);
    const parentPath = join(repoRoot, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = `${parent}/${entry.name}/package.json`;
      if (existsSync(join(repoRoot, candidate))) found.push(candidate);
    }
  }
  return found.sort();
}

const result = checkVersions({
  root: readManifest(join(repoRoot, "package.json"), "package.json"),
  workspaces: workspaceManifestPaths().map((path) => readManifest(join(repoRoot, path), path)),
  gitRef: process.env["GITHUB_REF"],
});

if (result.ok) {
  process.stdout.write(`version:check ✓ every manifest is ${String(result.version)}\n`);
} else {
  for (const problem of result.problems) process.stderr.write(`version:check ✗ ${problem}\n`);
  process.stderr.write(
    "Fix with: npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version\n",
  );
  process.exitCode = 1;
}
