import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { InternalError, UsageError } from "../../errors.js";
import { sanitizeGitEnv } from "../../git-env.js";

/**
 * The workspace's own git repository (SPEC.md §4). `corpus init` is one of the
 * two bootstrap-class operations allowed to write files directly (§2.2 rule 4),
 * and creating the repository is part of that — every later mutation commits on
 * top of the commit made here.
 *
 * Git is driven through `execFile`, never a shell: workspace paths come from the
 * operator and a shell would make them injectable.
 */

/**
 * The identity every workspace commit made on the operator's behalf carries.
 * `git log` is the corpus's audit trail, so the author has to be the acting
 * party (`user` / `agent`), not whoever happens to be configured globally on
 * this machine — a workspace cloned to a second machine must read the same.
 */
export const USER_IDENTITY = { name: "user", email: "user@corpus.local" } as const;

export const DEFAULT_BRANCH = "main";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one git invocation. Injectable so the failure paths are testable. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

const execFileAsync = promisify(execFile);

/**
 * The child environment is sanitized, not inherited: git exports `GIT_DIR`,
 * `GIT_INDEX_FILE`, `GIT_AUTHOR_*` and friends to the hooks it runs, so
 * `corpus init` from inside one would otherwise initialize, stage and commit
 * against *that* repository, attributing the workspace's first commit to
 * whoever triggered the hook. With them gone, the `-c` arguments in
 * {@link commitAll} are the only source of attribution.
 */
export const runGit: GitRunner = async (args, cwd) => {
  const { stdout, stderr } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: sanitizeGitEnv(),
  });
  return { stdout, stderr };
};

/**
 * Probe `git --version` before anything is created. A missing git has to fail on
 * an empty directory, not halfway through a scaffold the operator then has to
 * clean up by hand.
 */
export async function requireGit(git: GitRunner = runGit, cwd: string = "."): Promise<string> {
  try {
    const { stdout } = await git(["--version"], cwd);
    return stdout.trim();
  } catch (cause) {
    throw new UsageError(
      "`git` was not found on PATH, and a Corpus workspace is a git repository",
      {
        hint: "Install git (macOS: `xcode-select --install`; Debian/Ubuntu: `apt install git`) and run `corpus init` again.",
        cause,
      },
    );
  }
}

/**
 * Whether this directory is itself a repository root. Deliberately not
 * `git rev-parse`, which walks upward: initializing a workspace inside an
 * unrelated repository's subdirectory must create its own repository, not
 * commit into its parent's.
 */
export function isRepositoryRoot(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

export async function initRepository(dir: string, git: GitRunner = runGit): Promise<void> {
  await git(["init", "-b", DEFAULT_BRANCH], dir);
}

export interface CommitOptions {
  readonly dir: string;
  readonly message: string;
  readonly identity?: GitIdentity;
  readonly git?: GitRunner;
}

/**
 * Stages everything git will accept (the workspace `.gitignore` is already in
 * place, so runtime state stays out) and commits it under the acting party's
 * identity. `-c` rather than `git config` so nothing is written into the new
 * repository that a later `git commit` by the operator would inherit.
 */
export async function commitAll(options: CommitOptions): Promise<void> {
  const git = options.git ?? runGit;
  const identity = options.identity ?? USER_IDENTITY;
  const asIdentity = [
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
    // A workspace commit must not be signed with the operator's key: the author
    // is `user`, not them, and a signing prompt would hang a detached init.
    "-c",
    "commit.gpgsign=false",
  ];

  // Hooks are deliberately not skipped: SPEC.md §14 has the workspace's own
  // hooks validate every commit, and the first one is no exception.
  await git(["add", "--all", "--", "."], options.dir);
  await git([...asIdentity, "commit", "-m", options.message], options.dir);
}

/** `git`'s own stderr is the actionable part; surface it rather than a stack. */
export function gitFailure(action: string, cause: unknown): InternalError {
  const detail =
    typeof cause === "object" && cause !== null && "stderr" in cause
      ? String(cause.stderr).trim()
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return new InternalError(
    `${action} failed: ${detail === "" ? "git reported no detail" : detail}`,
    {
      cause,
    },
  );
}
