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
 * rather than a hard-coded list, so a new workspace under an already-declared
 * glob joins the check by existing.
 *
 * That only holds for the glob forms below, and npm accepts more than these. A
 * form this module cannot resolve is reported (`unsupportedGlobs`) and fails the
 * check — never skipped. A workspace that quietly stops being checked is the
 * same defect as INFRA-022 itself: a guard that looks like it covers something
 * it does not.
 *
 * Every read here refuses the same way. A glob it cannot resolve fails the check
 * because the repository's configuration outran the checker and the message can
 * name the fix; a manifest git listed and then could not produce (`gitOrThrow`)
 * throws, because there is no version verdict to report over data that was never
 * read. Neither is ever dropped.
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

/** Anything that makes a path segment mean more than itself to npm's glob engine. */
const GLOB_META = /[*?[\]{}()!+@]/;

/**
 * The two forms this module resolves: an exact directory (`tools/solo`) and one
 * level below a literal parent (`apps/*`). Between them they cover every glob
 * this repo has ever declared.
 *
 * Deliberately a path filter and not a glob engine. Keeping it one small pure
 * function is what stops the disk reader and the git reader selecting different
 * sets — and a real matcher would have to be paired with a directory walk on the
 * disk side, whose skip rules are their own silent-omission risk. The cost is
 * that `plugins/**`, `apps/{a,b}` and `!plugins/_fixture` are not understood;
 * the answer to that is to say so, loudly, not to drop them.
 */
export function isSupportedWorkspaceGlob(glob: string): boolean {
  const literal = glob.endsWith("/*") ? glob.slice(0, -2) : glob;
  return literal !== "" && !GLOB_META.test(literal);
}

export interface WorkspaceSelection {
  /** Manifest paths the supported globs select, sorted and deduplicated. */
  readonly selected: readonly string[];
  /**
   * Globs this selector cannot resolve. The caller reports them as a failure:
   * a workspace they would have selected is going unchecked, and silence about
   * that is the whole class of bug INFRA-022 belongs to.
   */
  readonly unsupported: readonly string[];
}

/** The workspace manifests a glob list selects out of `candidates`. */
export function selectWorkspaceManifests(
  globs: readonly string[],
  candidates: readonly string[],
): WorkspaceSelection {
  const selected = new Set<string>();
  const unsupported: string[] = [];
  for (const glob of globs) {
    if (!isSupportedWorkspaceGlob(glob)) {
      unsupported.push(glob);
      continue;
    }
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
  return { selected: [...selected].sort(), unsupported };
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
    if (!isSupportedWorkspaceGlob(glob)) continue;
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
  const selection = selectWorkspaceManifests(globs, present);

  return {
    label: WORKING_TREE_LABEL,
    root: parseManifest(rootSource, "package.json"),
    workspaces: selection.selected.map((path) =>
      parseManifest(readFileSync(join(repoRoot, path), "utf8"), path),
    ),
    unsupportedGlobs: selection.unsupported,
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
 * A read from a treeish already proven to resolve, where failure is not an
 * answer — hence no `undefined` in the return type.
 *
 * `readCommittedSource` calls this only after `git show <treeish>:package.json`
 * has succeeded, and only for paths `git ls-tree` itself just listed at that very
 * treeish. Git refusing at that point means the ref moved under the check
 * mid-read, or the object store is damaged (both reproducible, both covered in
 * `version-sources.test.ts`).
 *
 * Deliberately not routed through `unsupportedGlobs`. That channel describes a
 * healthy repository whose *configuration* outran this module, so it belongs in
 * the report and its message can name the fix. An object git listed and then
 * could not produce is not a version problem and has no manifest-level fix —
 * there is simply no answer to give. What it must never become is a shrug:
 * skipping the manifest would make the check quietly cover less than it claims,
 * which is the INFRA-022 defect this module exists to prevent. So it throws, and
 * `version:check` dies here instead of printing ✓ over manifests it never read —
 * the same thing that already happens one step later when a committed manifest
 * turns out not to be parseable JSON.
 */
function gitOrThrow(repoRoot: string, args: readonly string[], treeish: string): string {
  const output = git(repoRoot, args);
  if (output === undefined) {
    throw new Error(
      `\`git ${args.join(" ")}\` failed although \`${treeish}\` had already been read — the ` +
        "tree moved mid-check, or this repository's object store is damaged. Refusing to " +
        "report a version check over manifests that could not be read: re-run, and if it " +
        "persists, check the repository with `git fsck`.",
    );
  }
  return output;
}

/**
 * Manifests as they are committed — what a `v*` tag would carry.
 *
 * `undefined` when there is nothing to read at all: not a git repository, no
 * commits yet, or a treeish that does not resolve. The caller says so out loud
 * rather than treating an unreadable tree as a passing one. A tree that resolves
 * but then reads back incompletely is a different thing and throws — see
 * `gitOrThrow`.
 */
export function readCommittedSource(
  repoRoot: string,
  treeish: string = COMMITTED_TREEISH,
): VersionSource | undefined {
  const rootSource = git(repoRoot, ["show", `${treeish}:package.json`]);
  if (rootSource === undefined) return undefined;

  const globs = workspaceGlobs(rootSource);
  // An empty listing here would be indistinguishable from a tree with no
  // workspaces in it, and would take every one of them out of the check at once.
  const tracked = gitOrThrow(repoRoot, ["ls-tree", "-r", "--name-only", treeish], treeish);
  const paths = tracked.split("\n").filter((line) => line !== "");

  const selection = selectWorkspaceManifests(globs, paths);

  return {
    label: committedTreeLabel(treeish),
    root: parseManifest(rootSource, "package.json"),
    workspaces: selection.selected.map((path) =>
      parseManifest(gitOrThrow(repoRoot, ["show", `${treeish}:${path}`], treeish), path),
    ),
    unsupportedGlobs: selection.unsupported,
  };
}
