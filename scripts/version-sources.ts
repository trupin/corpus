/**
 * Where the version-singularity check gets its manifests from (INFRA-022).
 *
 * Two trees, because they can disagree and the disagreement is the bug this
 * module exists for: `npm version --workspaces --include-workspace-root`
 * rewrites every workspace manifest but commits only the root one, so a check
 * that reads disk reports success over a commit — and a tag — where nothing but
 * the root moved.
 *
 * Both readers enumerate workspaces from the root manifest's `workspaces` globs
 * rather than a hard-coded list, so a new workspace joins the check by existing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ManifestVersion, VersionSource } from "./versions.js";

const ManifestSchema = z.looseObject({
  version: z.string().min(1).optional(),
  workspaces: z.array(z.string()).optional(),
});

/** The tree the committed reader inspects when no other is named. */
export const COMMITTED_TREEISH = "HEAD";

export const WORKING_TREE_LABEL = "working tree";

export function committedTreeLabel(treeish: string): string {
  return `committed tree (${treeish})`;
}

/**
 * The workspace manifests a glob list selects out of `candidates`.
 *
 * Every glob npm workspaces uses here is one level deep (`apps/*`), so this is
 * a path filter rather than a glob engine — and keeping it one pure function
 * means the disk reader and the git reader cannot select different sets.
 */
export function selectWorkspaceManifests(
  globs: readonly string[],
  candidates: readonly string[],
): string[] {
  const selected = new Set<string>();
  for (const glob of globs) {
    if (!glob.endsWith("/*")) {
      const direct = `${glob}/package.json`;
      if (candidates.includes(direct)) selected.add(direct);
      continue;
    }
    const prefix = `${glob.slice(0, -2)}/`;
    for (const candidate of candidates) {
      if (!candidate.startsWith(prefix) || !candidate.endsWith("/package.json")) continue;
      // `<parent>/<workspace>/package.json` and nothing deeper — a nested
      // package.json (a fixture, a plugin's own dependency) is not a workspace.
      if (candidate.slice(prefix.length).split("/").length === 2) selected.add(candidate);
    }
  }
  return [...selected].sort();
}

function parseManifest(source: string, displayPath: string): ManifestVersion {
  const parsed: unknown = JSON.parse(source);
  return { path: displayPath, version: ManifestSchema.parse(parsed).version };
}

function workspaceGlobs(rootManifest: string): readonly string[] {
  const parsed: unknown = JSON.parse(rootManifest);
  return ManifestSchema.parse(parsed).workspaces ?? [];
}

/** Manifests as they are on disk — what a developer is looking at. */
export function readWorkingTreeSource(repoRoot: string): VersionSource {
  const rootSource = readFileSync(join(repoRoot, "package.json"), "utf8");
  const globs = workspaceGlobs(rootSource);

  const candidates: string[] = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*")) {
      candidates.push(`${glob}/package.json`);
      continue;
    }
    const parent = glob.slice(0, -2);
    const parentPath = join(repoRoot, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`${parent}/${entry.name}/package.json`);
    }
  }
  const present = candidates.filter((path) => existsSync(join(repoRoot, path)));

  return {
    label: WORKING_TREE_LABEL,
    root: parseManifest(rootSource, "package.json"),
    workspaces: selectWorkspaceManifests(globs, present).map((path) =>
      parseManifest(readFileSync(join(repoRoot, path), "utf8"), path),
    ),
  };
}

function git(repoRoot: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/**
 * Manifests as they are committed — what a `v*` tag would carry.
 *
 * `undefined` when there is nothing to read: not a git repository, no commits
 * yet, or a treeish that does not resolve. The caller says so out loud rather
 * than treating an unreadable tree as a passing one.
 */
export function readCommittedSource(
  repoRoot: string,
  treeish: string = COMMITTED_TREEISH,
): VersionSource | undefined {
  const rootSource = git(repoRoot, ["show", `${treeish}:package.json`]);
  if (rootSource === undefined) return undefined;

  const globs = workspaceGlobs(rootSource);
  const tracked = git(repoRoot, ["ls-tree", "-r", "--name-only", treeish]);
  const paths = tracked === undefined ? [] : tracked.split("\n").filter((line) => line !== "");

  const workspaces: ManifestVersion[] = [];
  for (const path of selectWorkspaceManifests(globs, paths)) {
    const source = git(repoRoot, ["show", `${treeish}:${path}`]);
    if (source !== undefined) workspaces.push(parseManifest(source, path));
  }

  return {
    label: committedTreeLabel(treeish),
    root: parseManifest(rootSource, "package.json"),
    workspaces,
  };
}
