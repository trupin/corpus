// Boot recovery: what a previous run left uncommitted (SPEC.md §4).
//
// "A window never outlives the server silently. A clean stop commits the open
// window. An unclean stop leaves those changes on disk … and the **next server
// start commits them as a recovery commit**: one whose subject says it is
// recovering changes left uncommitted by a previous run, and how many documents
// it holds, so no reader mistakes it for an ordinary one."
//
// **What this actually finds.** Not a lost window. Under the amend mechanism a
// window's content is in git *at every instant* — the first save commits and
// every later one amends — so an unclean stop costs the boundary, never the
// work. Recovery exists for the changes the commit path never saw:
//
//   1. **A commit git refused** (SPEC.md §14) — a workspace hook, a full disk, a
//      mid-rebase repository. The mutation stood and stayed on disk.
//   2. **Out-of-band edits** made while the server was down. While it is up the
//      watcher commits them for itself, authored `user` (SERVER-090), so what
//      reaches here is what nobody was watching.
//   3. An **operator's own file** dropped into `data/docs/` by hand. Recovery
//      commits it, and that is correct: §5 says the file on disk is the truth,
//      so a markdown file under a document root *is* a document of this
//      workspace whoever wrote it.
//
// Bootstrap-class writes (`corpus init`, `corpus workspace upgrade` — §2.2 rule
// 4) are deliberately *not* in that list: both commit what they wrote before
// they exit, so by the time a server boots the tree is clean and recovery finds
// nothing. Verified against `apps/cli/src/commands/init/git.ts` and
// `apps/cli/src/commands/workspace/upgrade.ts`, not merely against the spec.
//
// **It claims no party.** Which party's window was open is precisely what the
// unclean stop destroyed, and `git log --author=user` must not gain a commit no
// person made. §4 names this as §7's single deliberate exception (SHARED-040
// Decision 2, signed by the user 2026-08-09). It is therefore not expressible as
// an `Actor` — a two-member union across the whole contract — and this path
// reaches git directly instead of through `AutoCommitter.commit`, whose
// `CommitRequest` requires one.
//
// **An ordinary boot costs one git invocation and says nothing.** Every boot of
// every healthy workspace takes this path, so the question "is there anything to
// recover?" is asked first, with the cheapest thing that can answer it, and
// every other check — is HEAD detached, is a rebase in progress, who is the
// committer — is paid for only once the answer is yes.

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_ROOTS, classifyPath } from "../projection/index.js";
import { silentLogger, type Logger } from "../logger.js";
import { FALLBACK_COMMITTER, RECOVERY_AUTHOR } from "./commit.js";
import { gitOutput, type Git, type GitCommandResult } from "./git.js";

/**
 * The workspace's own document roots, and the whole of what recovery may touch
 * (SPEC.md §4 — "scoped to the workspace's own document roots and never sweeps
 * up unrelated files an operator left dirty").
 *
 * Read off {@link DOCUMENT_ROOTS} rather than restated, because the set is not
 * `data/docs` alone: threads, installed skills, archived skills and agent
 * definitions are documents too, and a recovery that missed `.claude/skills/`
 * would quietly not cover the tree §7's loop safety reverts through. `.corpus/`
 * is gitignored and is not a root; nor is anything else in the workspace — an
 * operator's dirty file beside `data/` stays dirty.
 */
export const RECOVERY_ROOTS: readonly string[] = DOCUMENT_ROOTS.map((root) => root.path);

/**
 * The subject a recovery commit carries. It has to say two things and does:
 * that these changes were left uncommitted by a previous run, and **how many
 * documents** — never which ones, because a recovery may hold hundreds and
 * `git log --name-only` already names every path.
 */
export const recoverySubject = (documents: number): string =>
  `recovery: ${documents} document${documents === 1 ? "" : "s"} left uncommitted by a previous run`;

export type RecoveryOutcome =
  /** Nothing to recover — every ordinary boot. Silent, and costs one `git status`. */
  | { readonly kind: "clean" }
  /**
   * Not a git repository, or no git at all. Silent, exactly as every other git
   * path in the server treats it: both are ordinary states of a usable
   * workspace (SPEC.md §14).
   */
  | { readonly kind: "unavailable"; readonly reason: string }
  /** The repository is in a state no commit may be made in. One log line, then boot continues. */
  | { readonly kind: "skipped"; readonly reason: string }
  | {
      readonly kind: "recovered";
      readonly sha: string;
      readonly documents: number;
      /** Every path the commit holds — documents and their non-document neighbours alike. */
      readonly paths: readonly string[];
    }
  /** git refused (SPEC.md §14). The changes stay on disk and the index is restored. */
  | { readonly kind: "failed"; readonly reason: string; readonly output: string };

export interface BootRecoveryOptions {
  readonly git: Git;
  /**
   * `AutoCommitter.withGitLock` — the same serialization every commit the server
   * makes takes, so a mutation arriving while recovery is mid-commit queues
   * behind it rather than cross-contaminating `.git/index`.
   */
  readonly withGitLock: <T>(run: () => Promise<T>) => Promise<T>;
  readonly logger?: Logger | undefined;
}

/**
 * Every path `git status --porcelain -z` reported, decoded.
 *
 * `-z` rather than the default: porcelain v1 quotes and C-escapes any path with
 * a space or a non-ASCII byte, and a workspace whose documents are titled in
 * French would otherwise be recovered under mangled names. NUL-separated output
 * is never quoted.
 *
 * A rename or copy entry (`X` in `RC`) is followed by a second field holding the
 * *original* path. Both are taken: the rename's other half is a staged deletion,
 * and committing only the new path would leave that deletion in the index for
 * the next commit by anything at all to swallow.
 */
const parseStatusPaths = (stdout: string): string[] => {
  const fields = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    // `XY <path>`: two status characters, a space, then at least one character
    // of path. The trailing empty field after the last NUL falls out here.
    if (entry === undefined || entry.length < 4) continue;
    paths.push(entry.slice(3));
    const staged = entry[0];
    if (staged === "R" || staged === "C") {
      const original = fields[index + 1];
      index += 1;
      if (original !== undefined && original !== "") paths.push(original);
    }
  }
  return paths;
};

/**
 * How many **documents** the recovery holds — not how many files. A skill is a
 * folder of several files and one document, so the count is of the paths the
 * projection would index as documents (`classifyPath`), which is exactly one per
 * skill folder and none for its helpers.
 *
 * A recovery can therefore legitimately hold `0 documents`: an image or a script
 * beside a document changed and the document did not. The subject says so rather
 * than inflating the count to the file count, because "how many documents" is
 * what §4 asks it to say.
 */
const countDocuments = (paths: readonly string[]): number =>
  new Set(paths.filter((path) => classifyPath(path) !== null)).size;

/** The workspace's own git identity, or the neutral fallback when it configures none. */
const committerFlags = async (git: Git): Promise<readonly string[]> => {
  const configured = await git.exec(["config", "--get", "user.email"]);
  return configured.ok && configured.stdout.trim() !== ""
    ? []
    : [
        "-c",
        `user.name=${FALLBACK_COMMITTER.name}`,
        "-c",
        `user.email=${FALLBACK_COMMITTER.email}`,
      ];
};

const headSha = async (git: Git): Promise<string | null> => {
  const result = await git.exec(["rev-parse", "--verify", "--quiet", "HEAD"]);
  return result.ok && result.stdout.trim() !== "" ? result.stdout.trim() : null;
};

/**
 * The in-progress operation, or `null`. One invocation rather than five
 * `rev-parse --git-path` calls: the marker files all live directly in the
 * per-worktree git directory, so resolving it once and asking the filesystem is
 * both cheaper and the same answer.
 */
const midOperation = async (git: Git): Promise<string | null> => {
  const dir = await git.exec(["rev-parse", "--absolute-git-dir"]);
  if (!dir.ok || dir.stdout.trim() === "") return null;
  const gitDir = dir.stdout.trim();
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ]) {
    if (existsSync(join(gitDir, name))) return name;
  }
  return null;
};

/**
 * Is the repository this workspace's own, rather than one it happens to sit
 * inside? A workspace nested in an unrelated repository would otherwise have its
 * operator's whole document tree committed into *that* history under an author
 * they have never heard of — and the porcelain paths would be prefixed by the
 * workspace's own directory name, so nothing downstream would classify either.
 *
 * `realpath` on both sides: a macOS temporary directory is reached as `/var/…`
 * and reported as `/private/var/…`, and a workspace under a symlinked home
 * directory is the same problem in production.
 */
const ownsRepository = async (git: Git): Promise<boolean> => {
  const toplevel = await git.exec(["rev-parse", "--show-toplevel"]);
  if (!toplevel.ok || toplevel.stdout.trim() === "") return false;
  try {
    return realpathSync(toplevel.stdout.trim()) === realpathSync(git.root);
  } catch {
    return false;
  }
};

/** Restore the index for the paths an attempt staged, leaving the working tree alone. */
const unstage = async (
  git: Git,
  paths: readonly string[],
  head: string | null,
  logger: Logger,
): Promise<void> => {
  if (paths.length === 0) return;
  const result =
    head === null
      ? await git.exec(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...paths])
      : await git.exec(["reset", "--quiet", "HEAD", "--", ...paths]);
  if (!result.ok) {
    logger.error("could not restore the index after a recovery commit that did not land", {
      output: gitOutput(result),
    });
  }
};

const failure = (reason: string, result: GitCommandResult): RecoveryOutcome => ({
  kind: "failed",
  reason,
  output: gitOutput(result),
});

async function attempt(git: Git, logger: Logger): Promise<RecoveryOutcome> {
  // The only invocation an ordinary boot pays for, and the first thing asked:
  // the answer is "nothing" on every healthy start, and everything below is
  // wasted work when it is.
  const status = await git.exec(["status", "--porcelain", "-z", "-uall", "--", ...RECOVERY_ROOTS]);
  if (!status.ok) {
    if (!status.spawned) return { kind: "unavailable", reason: "git is not available on PATH" };
    const repository = await git.exec(["rev-parse", "--git-dir"]);
    if (!repository.ok)
      return { kind: "unavailable", reason: "the workspace is not a git repository" };
    return failure("could not inspect the workspace for uncommitted changes", status);
  }

  const paths = [...new Set(parseStatusPaths(status.stdout))];
  if (paths.length === 0) return { kind: "clean" };

  if (!(await ownsRepository(git))) {
    return { kind: "skipped", reason: "the workspace is not the root of its git repository" };
  }
  // Detached HEAD: a commit there lands on no branch and is lost to the next
  // checkout. Same ruling `commit.ts` already makes for every other commit.
  if (!(await git.exec(["symbolic-ref", "--quiet", "HEAD"])).ok) {
    return { kind: "skipped", reason: "HEAD is detached" };
  }
  const operation = await midOperation(git);
  if (operation !== null) {
    return { kind: "skipped", reason: `a git operation is in progress (${operation})` };
  }

  const head = await headSha(git);
  // `-A` so a tracked file deleted out of band stages as a removal rather than
  // being silently left behind in the tree.
  const staged = await git.exec(["add", "-A", "--", ...paths]);
  if (!staged.ok) {
    await unstage(git, paths, head, logger);
    return failure("staging the recovered changes failed", staged);
  }

  const documents = countDocuments(paths);
  const committed = await git.exec([
    ...(await committerFlags(git)),
    "commit",
    // The one commit in a workspace that names no acting party. No
    // `Corpus-Actor` trailer either — a recovery has none to state, and a
    // trailer is what `git log --grep` and `amendableHead` read.
    `--author=${RECOVERY_AUTHOR.name} <${RECOVERY_AUTHOR.email}>`,
    "-m",
    recoverySubject(documents),
    // `--only` commits exactly these paths' working-tree content and disregards
    // whatever else is staged, so an operator's staged work outside the document
    // roots is never swallowed by a recovery.
    "--only",
    "--",
    ...paths,
  ]);
  if (!committed.ok) {
    await unstage(git, paths, head, logger);
    return failure("the recovery commit failed", committed);
  }

  const sha = await headSha(git);
  if (sha === null) {
    await unstage(git, paths, head, logger);
    return failure("the recovery commit produced no HEAD", committed);
  }
  return { kind: "recovered", sha, documents, paths };
}

/**
 * Commit whatever a previous run left uncommitted under the workspace's document
 * roots, as a single recovery commit (SPEC.md §4).
 *
 * Never throws and never prevents a start: a workspace whose commits git refuses
 * is still a workspace you can read, and §14 already says the changes stand on
 * disk. Runs inside the git lock, so it cannot interleave with a mutation.
 */
export async function recoverUncommittedChanges(
  options: BootRecoveryOptions,
): Promise<RecoveryOutcome> {
  const { git, withGitLock } = options;
  const logger = options.logger ?? silentLogger;

  // Structurally, not by argument: `Git.exec` reports a non-zero exit as a
  // result rather than a throw and every filesystem call below it is guarded, so
  // nothing here is expected to throw — but this runs on the path to the bind,
  // and "a workspace that cannot commit is still a workspace you can read" must
  // not depend on that reasoning staying true.
  const outcome = await withGitLock(() => attempt(git, logger)).catch(
    (error: unknown): RecoveryOutcome => ({
      kind: "failed",
      reason: "recovery could not run",
      output: String(error),
    }),
  );
  switch (outcome.kind) {
    case "clean":
    case "unavailable":
      // Says nothing. Every ordinary boot ends here, and a line on each one
      // would train the operator to stop reading the log.
      break;
    case "skipped":
      logger.info("skipped recovering changes left uncommitted by a previous run", {
        reason: outcome.reason,
      });
      break;
    case "recovered":
      logger.info("recovered changes left uncommitted by a previous run", {
        sha: outcome.sha,
        documents: outcome.documents,
        files: outcome.paths.length,
      });
      break;
    case "failed":
      // SPEC.md §14: loudly, and the changes stand. The operator can commit them
      // by hand; the server serves the workspace either way.
      logger.error("could not commit changes left uncommitted by a previous run", {
        reason: outcome.reason,
        output: outcome.output,
      });
      break;
  }
  return outcome;
}
