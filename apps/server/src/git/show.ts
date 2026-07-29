// Reading committed content at an arbitrary revision (SPEC.md §7 — the targeted
// revert behind `corpus skill rollback`).
//
// `watcher/git-head.ts`'s `readHeadVersion` answers the same question, pinned to
// `HEAD`, and deliberately stays where it is: it is `execFileSync`, which is what
// the watcher's *synchronous* `flush()` needs and what `WATCH_FLUSH_BUDGET_MS`
// budgets. This is the asynchronous, ref-parameterised form, built on the one
// `Git` command builder so a rollback inherits its sanitized environment, its
// `maxBuffer` and its timeout — and so a caller can hold `AutoCommitter`'s git
// lock across a read and the commit that follows it.
//
// **Nothing here throws.** "That ref does not resolve", "the file did not exist
// at that revision" and "this workspace has no git" are answers a rollback has to
// give its caller, not exceptions — the same rule the rest of `git/` follows.
//
// **Every revision is resolved to a sha before it is interpolated.** A ref
// arrives from the request body, and `git show <ref>:./<path>` would hand a ref
// beginning with `-` to git as an option. Refs are never passed through: they are
// verified once, and every later invocation uses the 40-hex answer.

import type { Git } from "./git.js";

/**
 * How far back the last-known-good search walks. A bound rather than the whole
 * history because each candidate costs one `git show`, and the answer is almost
 * always the first or second one — a skill's newest revision is the bad edit and
 * the one before it is what the operator wants back. When the walk is exhausted
 * the refusal says so rather than pretending the file has no earlier version.
 */
export const REVISION_SEARCH_LIMIT = 50;

/** A ref git could mistake for one of its own options is never passed to git at all. */
const isOptionLike = (ref: string): boolean => ref.startsWith("-");

/**
 * The commit sha `ref` names, or `null` when git does not resolve it (an unknown
 * revision, a workspace with no repository, no `git` on `PATH`).
 *
 * `^{commit}` peels tags, so a caller always receives something `git show` can
 * address, and `--verify` makes an ambiguous or absent revision a `null` rather
 * than an approximation.
 */
export async function resolveRevision(git: Git, ref: string): Promise<string | null> {
  if (ref === "" || isOptionLike(ref)) return null;
  const result = await git.exec(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  return result.ok && sha !== "" ? sha : null;
}

/**
 * The content of a workspace-relative path at `sha`, or `null` when the path did
 * not exist there (or was a directory, or the revision is unreadable).
 *
 * The `<sha>:./path` spelling resolves the path against the process's working
 * directory rather than the repository root, which is what makes this correct for
 * a workspace nested inside a larger repository — the same reason
 * `readHeadVersion` spells it that way.
 */
export async function readVersionAt(
  git: Git,
  sha: string,
  relativePath: string,
): Promise<string | null> {
  const result = await git.exec(["show", `${sha}:./${relativePath}`]);
  return result.ok ? result.stdout : null;
}

/**
 * The commits that touched `relativePath`, newest first — the candidate list a
 * last-known-good search walks. Empty for an untracked file, a repository with no
 * commits, and a workspace with no git, all of which are ordinary states.
 */
export async function listFileRevisions(
  git: Git,
  relativePath: string,
  limit: number = REVISION_SEARCH_LIMIT,
): Promise<string[]> {
  const result = await git.exec(["log", `-n${String(limit)}`, "--format=%H", "--", relativePath]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
