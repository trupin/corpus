/**
 * `npm run release:prepare <x.y.z>` — bump, commit, verify, tag (INFRA-022).
 *
 * ## Why this wrapper exists
 *
 * The documented mechanism used to be `npm version <x.y.z> --workspaces
 * --include-workspace-root`, and it does not do what the sentence implies. It
 * rewrites every workspace manifest, then commits only `package.json` and
 * `package-lock.json`, then tags that commit. The workspace manifests are left
 * uncommitted in the working tree and the tag points at a tree where only the
 * root version moved.
 *
 * `npm version` is not misbehaving by its own lights: it is a single-package
 * command whose git step has always meant "commit the version of *this*
 * package". `--workspaces` extends the rewriting, not the committing, and npm
 * cannot know that this repo has declared one version for all of them
 * (INFRA-008). What it leaves behind is only wrong relative to a convention it
 * has never been told about — which is exactly the kind of gap a wrapper is for.
 *
 * The trap was that nothing caught it: `version:check` read the working tree,
 * where all seven manifests were already correct, so it passed while the tag
 * carried a tree that would fail. v0.4.0 was lost that way. `version:check` now
 * reads both trees (`scripts/version-sources.ts`), and this script removes the
 * ordering mistake that made the two disagree — bump, stage every manifest,
 * one commit, verify **the committed tree**, and only then tag.
 *
 * Pushing stays a separate, human act: this prints the two commands and stops.
 * Recovery when a tag is already pushed is in `docs/RELEASING.md`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { checkVersionSources } from "./versions.js";
import { readCommittedSource, readWorkingTreeSource } from "./version-sources.js";
import {
  classifyBumpChanges,
  expectedBumpPaths,
  parsePorcelainPaths,
  parseReleaseArgs,
  releaseCommitMessage,
  releaseTag,
  releaseTagMessage,
} from "./release.js";

function fail(message: string, ...hints: readonly string[]): never {
  process.stderr.write(`release:prepare ✗ ${message}\n`);
  for (const hint of hints) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
}

function say(message: string): void {
  process.stdout.write(`release:prepare ▶ ${message}\n`);
}

/**
 * The repo is located from the *current directory*, not from this file: the
 * script has to be drivable against a scratch repository for the rehearsal that
 * proves it (`release-prepare.test.ts`), and locating it from `cwd` also means
 * it works from any subdirectory.
 */
function repoRootFromCwd(): string {
  const found = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (found.status !== 0) fail("not inside a git repository");
  return found.stdout.trim();
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function run(repoRoot: string, command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", shell: false });
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed`);
}

const parsed = parseReleaseArgs(process.argv.slice(2));
if ("error" in parsed) fail(parsed.error);
const { version, title } = parsed;
const tag = releaseTag(version);

const repoRoot = repoRootFromCwd();

// ── Preconditions, all before anything is written ────────────────────────────

// Untracked files are none of this script's business — it stages by name — but a
// tracked modification is: it would either be swept into the release commit or
// left straddling it.
const dirty = parsePorcelainPaths(git(repoRoot, ["status", "--porcelain", "--untracked-files=no"]));
if (dirty.length > 0) {
  fail(
    `the working tree has uncommitted changes: ${dirty.join(", ")}`,
    "commit or stash them first — a release commit contains the version bump and nothing else",
  );
}

const existingTag = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (existingTag.status === 0) {
  fail(
    `${tag} already exists locally`,
    "if that release failed and was never published, see docs/RELEASING.md → Recovery",
  );
}

// ── Bump ─────────────────────────────────────────────────────────────────────

say(`bumping every manifest to ${version}`);
run(repoRoot, "npm", [
  "version",
  version,
  "--workspaces",
  "--include-workspace-root",
  // The point of the whole script: npm's own git step commits the root manifest
  // only. This script does the committing.
  "--no-git-tag-version",
]);

const workspacePaths = readWorkingTreeSource(repoRoot).workspaces.map((manifest) => manifest.path);
const changed = parsePorcelainPaths(
  git(repoRoot, ["status", "--porcelain", "--untracked-files=no"]),
);
const { toStage, unexpected } = classifyBumpChanges(changed, expectedBumpPaths(workspacePaths));

if (unexpected.length > 0) {
  fail(
    `the bump touched files that are not manifests: ${unexpected.join(", ")}`,
    "nothing has been committed or tagged; `git checkout -- .` restores the tree",
  );
}
if (toStage.length === 0) {
  fail(
    `nothing changed — every manifest is already ${version}`,
    "pick a new version, or if the bump is already committed, tag it per docs/RELEASING.md",
  );
}

// ── One commit, containing every manifest the bump changed ───────────────────

say(`staging ${String(toStage.length)} file(s): ${toStage.join(", ")}`);
git(repoRoot, ["add", "--", ...toStage]);

say("committing (the pre-commit gate runs now — this takes a few minutes)");
run(repoRoot, "git", ["commit", "-m", releaseCommitMessage(version, title)]);

// ── Verify the committed tree, before the tag can point at it ────────────────

const committed = readCommittedSource(repoRoot);
if (committed === undefined) fail("cannot read the commit that was just made");
const verified = checkVersionSources([committed]);
if (!verified.ok) {
  for (const problem of verified.problems) process.stderr.write(`release:prepare ✗ ${problem}\n`);
  fail(
    "the release commit does not carry one version — refusing to tag it",
    "the commit exists but no tag does; fix the manifests, amend or add a commit, and re-run",
  );
}
say(`the release commit carries ${version} in every manifest`);

git(repoRoot, ["tag", "-a", tag, "-m", releaseTagMessage(version, title)]);

process.stdout.write(
  `release:prepare ✓ ${releaseCommitMessage(version, title)} committed and tagged ${tag}\n` +
    "\nNothing has been pushed. To release:\n" +
    `  git push origin HEAD\n` +
    `  git push origin ${tag}\n` +
    "\nPushing the tag is what triggers .github/workflows/release.yml. See docs/RELEASING.md.\n",
);
