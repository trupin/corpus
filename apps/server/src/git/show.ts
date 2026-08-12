// Reading committed content at an arbitrary revision — what `GET /api/docs/{id}/diff`
// and the edit acknowledgment resolve their refs with, and the read half of §7's
// loop safety (the agent reads the version it wants back, then writes it through
// the ordinary write path; there is no server-side revert engine).
//
// `watcher/git-head.ts`'s `readHeadVersion` answers the same question, pinned to
// `HEAD`, and deliberately stays where it is: it is `execFileSync`, which is what
// the watcher's *synchronous* `flush()` needs and what `WATCH_FLUSH_BUDGET_MS`
// budgets. This is the asynchronous, ref-parameterised form, built on the one
// `Git` command builder so a reader inherits its sanitized environment, its
// `maxBuffer` and its timeout — and so a caller can hold `AutoCommitter`'s git
// lock across a read and the commit that follows it.
//
// **Nothing here throws.** "That ref does not resolve", "the file did not exist
// at that revision" and "this workspace has no git" are answers a caller has to
// give back, not exceptions — the same rule the rest of `git/` follows.
//
// **Every revision is resolved to a sha before it is interpolated.** A ref
// arrives from a request, and `git show <ref>:./<path>` would hand a ref
// beginning with `-` to git as an option. Refs are never passed through: they are
// verified once, and every later invocation uses the 40-hex answer.

import type { Git } from "./git.js";

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
 * The `limit` newest commits that touched `relativePath`, newest first. Empty for
 * an untracked file, a repository with no commits, and a workspace with no git,
 * all of which are ordinary states.
 *
 * The bound is required rather than defaulted: every caller knows how far back it
 * needs to look, and a default would be a guess sitting where a walk's cost is
 * paid.
 */
export async function listFileRevisions(
  git: Git,
  relativePath: string,
  limit: number,
): Promise<string[]> {
  const result = await git.exec(["log", `-n${String(limit)}`, "--format=%H", "--", relativePath]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
