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
 *
 * ## The failure paths matter as much as the happy one
 *
 * Everything between the bump and the commit unwinds on failure (`unwindAndFail`)
 * — the run either completes or leaves the tree as it found it. Anything else
 * leaves a tree that is bumped, staged, uncommitted and untagged, which is the
 * INFRA-022 shape all over again: the next thing a person does with it is commit
 * by hand, and that produces a commit with the wrong subject and no tag. The
 * likeliest failure is the most ordinary one — the pre-commit gate rejecting the
 * tree — so it is the one least allowed to leave debris.
 *
 * What is *not* weakened to make that tidy: the tag is still only ever created
 * from a commit whose tree has already been verified.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkVersionSources } from "./versions.js";
import { readCommittedSource, readWorkingTreeSource } from "./version-sources.js";
import {
  LOCKFILE,
  classifyBumpChanges,
  classifyLockfileChange,
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

/** `git`, but for a command that is allowed to have nothing to say. */
function gitOrUndefined(repoRoot: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout : undefined;
}

/** Runs a child with its output attached, and reports whether it succeeded. */
function run(repoRoot: string, command: string, args: readonly string[]): boolean {
  return spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", shell: false }).status === 0;
}

function trackedChanges(repoRoot: string): string[] {
  return parsePorcelainPaths(
    gitOrUndefined(repoRoot, ["status", "--porcelain", "--untracked-files=no"]) ?? "",
  );
}

interface UnwindFailure {
  readonly message: string;
  /** What exactly was wrong — printed before the account of the tree's state. */
  readonly detail?: readonly string[];
  /** What to do next — printed after it. */
  readonly hints?: readonly string[];
}

/**
 * Undo the bump, then explain — for every failure after `npm version` has run
 * and before a commit exists.
 *
 * Restoring is safe because of the clean-tree precondition: index *and* worktree
 * matched `HEAD` before the bump, so every tracked modification present now is
 * npm's work, never the user's. Untracked files are not touched, here as
 * everywhere else in this script.
 *
 * When the undo itself fails the run says so and prints the exact command,
 * because the one thing a person must not do with the leftover state is commit
 * it by hand.
 */
function unwindAndFail(repoRoot: string, failure: UnwindFailure): never {
  const detail = failure.detail ?? [];
  const hints = failure.hints ?? [];
  const changed = trackedChanges(repoRoot);

  if (changed.length === 0) {
    fail(
      failure.message,
      ...detail,
      "nothing was committed, no tag was created, and nothing was left behind",
      ...hints,
    );
  }

  const restored = run(repoRoot, "git", ["restore", "--staged", "--worktree", "--", ...changed]);
  if (restored) {
    fail(
      failure.message,
      ...detail,
      `nothing was committed and no tag was created; the bump was undone (${String(changed.length)} file(s) restored)`,
      ...hints,
    );
  }
  fail(
    failure.message,
    ...detail,
    "nothing was committed and no tag was created, but the bump could NOT be undone. Run:",
    `  git restore --staged --worktree -- ${changed.join(" ")}`,
    "do not commit the leftover bump by hand — a hand-made commit has neither the release subject nor a tag, which is the failure INFRA-022 exists to prevent",
    ...hints,
  );
}

const parsed = parseReleaseArgs(process.argv.slice(2));
if ("error" in parsed) fail(parsed.error);
const { version, title } = parsed;
const tag = releaseTag(version);

const repoRoot = repoRootFromCwd();

/** The command to type after fixing whatever stopped the run. */
const rerun =
  title === undefined
    ? `npm run release:prepare ${version}`
    : `npm run release:prepare ${version} "${title}"`;

// ── Preconditions, all before anything is written ────────────────────────────

// The set of manifests the bump is about to rewrite — read before it runs, so
// that a `workspaces` glob this repo's tooling cannot resolve stops the release
// rather than quietly narrowing what gets staged and checked.
const working = readWorkingTreeSource(repoRoot);
const unresolvableGlobs = working.unsupportedGlobs ?? [];
if (unresolvableGlobs.length > 0) {
  fail(
    `cannot resolve every workspaces glob: ${unresolvableGlobs.join(", ")}`,
    "a workspace one of them selects would be bumped by npm but neither staged nor version-checked",
    "declare it as an exact path or `<dir>/*`, or teach scripts/version-sources.ts the form",
  );
}

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
const bumped = run(repoRoot, "npm", [
  "version",
  version,
  "--workspaces",
  "--include-workspace-root",
  // The point of the whole script: npm's own git step commits the root manifest
  // only. This script does the committing.
  "--no-git-tag-version",
]);
if (!bumped) {
  unwindAndFail(repoRoot, { message: "`npm version` failed — see its output above" });
}

const workspacePaths = working.workspaces.map((manifest) => manifest.path);
const changed = trackedChanges(repoRoot);
const { toStage, unexpected } = classifyBumpChanges(changed, expectedBumpPaths(workspacePaths));

if (unexpected.length > 0) {
  // The one failure that does not unwind. Everywhere else this script knows
  // exactly what it wrote; here it has just discovered that it does not model
  // what `npm version` did, and those files are the only record of it. Choosing
  // to throw them away belongs to the person reading them.
  fail(
    `the bump touched files that are not manifests: ${unexpected.join(", ")}`,
    "nothing has been committed or tagged, and the changes have been left for you to read",
    `discard them all with: git restore --worktree -- ${changed.join(" ")}`,
  );
}
if (toStage.length === 0) {
  unwindAndFail(repoRoot, {
    message: `nothing changed — every manifest is already ${version}`,
    hints: [
      "pick a new version, or if the bump is already committed, tag it per docs/RELEASING.md",
    ],
  });
}

// ── The lockfile carries the bump and nothing else ───────────────────────────

if (toStage.includes(LOCKFILE)) {
  const before = gitOrUndefined(repoRoot, ["show", `HEAD:${LOCKFILE}`]);
  const lockChanges =
    before === undefined
      ? [`${LOCKFILE} could not be read out of HEAD, so its change cannot be reviewed`]
      : [
          ...classifyLockfileChange(before, readFileSync(join(repoRoot, LOCKFILE), "utf8"), version)
            .unexpected,
        ];
  if (lockChanges.length > 0) {
    const shown = lockChanges.slice(0, 10);
    const more = lockChanges.length - shown.length;
    unwindAndFail(repoRoot, {
      message: `${LOCKFILE} changed beyond the version bump — the release commit would carry it unreviewed`,
      detail: [
        ...shown.map((path) => `  ${path}`),
        ...(more > 0 ? [`  … and ${String(more)} more`] : []),
      ],
      hints: [
        "the bump runs an install, so a lockfile that had drifted gets repaired here; that repair is a change to review on its own",
        `run \`npm install\`, commit the lockfile, then re-run: ${rerun}`,
      ],
    });
  }
}

// ── One commit, containing every manifest the bump changed ───────────────────

say(`staging ${String(toStage.length)} file(s): ${toStage.join(", ")}`);
git(repoRoot, ["add", "--", ...toStage]);

say("committing (the pre-commit gate runs now — this takes a few minutes)");
if (!run(repoRoot, "git", ["commit", "-m", releaseCommitMessage(version, title)])) {
  unwindAndFail(repoRoot, {
    message: "the release commit failed — the pre-commit gate runs here, so its output is above",
    hints: [`fix what it reported, then re-run: ${rerun}`],
  });
}

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
