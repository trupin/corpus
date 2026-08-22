import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Actor } from "@corpus/contract";
import { InternalError, UsageError } from "../../errors.js";
import { sanitizeGitEnv } from "../../git-env.js";

/**
 * The workspace's own git repository (SPEC.md §4), and the CLI's **only**
 * write-side git. Both bootstrap-class operations use it — `corpus init` creates
 * the repository and makes the first commit, `corpus workspace upgrade` commits
 * the files it refreshed (§2.2 rule 4) — and neither has its own copy: two
 * implementations of "commit as the acting party" is two ways for the audit
 * trail to be wrong. (Read-only plumbing is the other module, `src/staged.ts`,
 * which may not commit at all.)
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

/**
 * The acting party as a git identity, matching what the server writes for the
 * same actor — a workspace's history must not tell `user` apart from `user`
 * depending on which process happened to commit.
 */
export function identityFor(actor: Actor): GitIdentity {
  return { name: actor, email: `${actor}@corpus.local` };
}

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
 * Every git child the CLI spawns is bounded (PR #42 review). Without it, §4's
 * "Maintenance never prevents a server from starting: a failure is reported and
 * the start proceeds" is false in the one case it most needs to hold: a
 * `git gc` that *hangs* — a wedged `gc.pid` lock, a stalled network filesystem —
 * is not a failure, so nothing catches it, and `corpus server start` waits
 * forever. A timeout turns the hang into the failure the sentence already
 * promises to handle.
 *
 * Generous on purpose, and the server's own `GIT_TIMEOUT_MS` is deliberately
 * *not* reused: that one budgets a commit's user-written hooks, where 30 s is
 * already suspicious. This one has to cover a real repack of a large corpus.
 * The measured pack of 7028 loose objects took 0.16 s (CLI-037), so two minutes
 * is three orders of magnitude of headroom — a bound on pathology, not a
 * performance budget.
 *
 * **What the bound does not cover, stated because the first draft of this
 * comment overclaimed it** (PR #42 re-review, finding 5). `execFile` sends
 * `SIGTERM` to the direct child only. `git gc` spawns `git repack` and
 * `pack-objects` as its own children, and those are not in the signalled set —
 * so on expiry the `gc` process dies while a repack may still be running, and
 * `corpus server start` then spawns the server beside it: the concurrent-writer
 * condition CLI-037 exists to remove, reached through the pathological door
 * rather than the ordinary one. Strictly better than hanging forever, and not
 * the whole fix. The killed process itself is safe — `gc` builds new packs and
 * swaps at the end, and a dead `gc.pid` is stolen by the next run — but that is
 * a claim about `gc`, not about its children.
 */
export const GIT_TIMEOUT_MS = 120_000;

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
    timeout: GIT_TIMEOUT_MS,
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

/**
 * The nearest ancestor that is a repository root, or `undefined`.
 * {@link isRepositoryRoot} answers "is this one"; `corpus init` also has to know
 * whether the target is *inside* one, because initializing there creates a
 * nested repository inside somebody else's checkout — the hazard is real even
 * when the target directory is empty, which is the one case a "non-empty" check
 * alone would miss (CLI-013).
 */
export function enclosingRepositoryRoot(start: string): string | undefined {
  for (let dir = resolve(start); ;) {
    if (isRepositoryRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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

  // Hooks are deliberately not skipped: SPEC.md §11 has the workspace's own
  // hooks validate every commit, and the first one is no exception.
  await git(["add", "--all", "--", "."], options.dir);
  await git(
    [...identityArgs(options.identity ?? USER_IDENTITY), "commit", "-m", options.message],
    options.dir,
  );
}

export interface CommitPathsOptions extends CommitOptions {
  /** Workspace-relative, `/`-separated paths — nothing else is committed. */
  readonly paths: readonly string[];
}

/**
 * Commits exactly the named paths and returns the new HEAD, or `null` when
 * those paths turned out to hold nothing new — restoring a file that was deleted
 * from the working tree but never committed puts the tree back exactly as HEAD
 * has it, and `git commit` refuses an empty commit for good reason.
 *
 * The pathspec is the point: `corpus workspace upgrade` runs in a workspace the
 * operator may have half-edited, and an `add --all` would sweep their in-progress
 * work into a commit that claims to be a tool upgrade. Passing the paths to
 * `commit` as well as to `add` means the operator's *index* is left alone too —
 * a partial commit reads the working tree for those paths and nothing else.
 */
export async function commitPaths(options: CommitPathsOptions): Promise<string | null> {
  const git = options.git ?? runGit;
  const pathspec = ["--", ...options.paths];

  await git(["add", ...pathspec], options.dir);
  if (!(await hasStagedChanges(git, options.dir, pathspec))) return null;

  await git(
    [
      ...identityArgs(options.identity ?? USER_IDENTITY),
      "commit",
      "-m",
      options.message,
      ...pathspec,
    ],
    options.dir,
  );
  const { stdout } = await git(["rev-parse", "HEAD"], options.dir);
  return stdout.trim();
}

/** `git diff --cached --quiet` exits `1` when the index differs from HEAD; `0` when it does not. */
async function hasStagedChanges(
  git: GitRunner,
  dir: string,
  pathspec: readonly string[],
): Promise<boolean> {
  try {
    await git(["diff", "--cached", "--quiet", ...pathspec], dir);
    return false;
  } catch (cause) {
    if (gitExitCode(cause) === 1) return true;
    throw cause;
  }
}

/**
 * The exit status behind a rejected {@link GitRunner} call. Several git commands
 * answer a yes/no question with their exit code — `diff --quiet`,
 * `check-ignore` — and reading it is how a caller tells an answer from a failure.
 */
export function gitExitCode(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "number" ? cause.code : undefined;
}

function identityArgs(identity: GitIdentity): readonly string[] {
  return [
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
    // A workspace commit must not be signed with the operator's key: the author
    // is the acting party, not them, and a signing prompt would hang a detached
    // `corpus init` or a scripted upgrade.
    "-c",
    "commit.gpgsign=false",
  ];
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
