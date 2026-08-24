import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
 * Git is driven through `spawn` with an argument vector, never a shell:
 * workspace paths come from the operator and a shell would make them injectable.
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
 * **The bound signals the whole process group, not the one child** (CLI-039).
 * An earlier draft of this comment recorded the gap rather than closing it:
 * `execFile`'s own `timeout` calls `child.kill()` on the **direct pid**, and
 * `git gc` forks `git repack` and `pack-objects` as its own children, so on
 * expiry the `gc` process died while a repack went on writing the object store.
 * `corpus server start` then spawned the server beside it — the concurrent-writer
 * condition CLI-037 exists to remove, reached through the pathological door
 * rather than the ordinary one. Measured before the fix: a child that forks and
 * hangs leaves the fork alive and reparented after the direct pid is signalled.
 *
 * So {@link runGit} spawns every git child `detached`, which puts it in a new
 * process group of its own, and the expiry signals `-pid` — the group — rather
 * than the pid. `git repack` and `pack-objects` inherit that group, so they are
 * in the signalled set.
 */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * How long the group gets to end on `SIGTERM` before it is sent `SIGKILL`.
 *
 * `git gc` builds new packs and swaps them in at the end, so a `SIGTERM` it
 * honours leaves the object store as it was and the next run steals the stale
 * `gc.pid`. The escalation exists for the member that ignores the polite
 * signal — the whole point of CLI-039 is that **no unsupervised writer may
 * outlive this call**, and a process that declines to leave is exactly that.
 */
export const GIT_KILL_GRACE_MS = 5_000;

/**
 * The child environment is sanitized, not inherited: git exports `GIT_DIR`,
 * `GIT_INDEX_FILE`, `GIT_AUTHOR_*` and friends to the hooks it runs, so
 * `corpus init` from inside one would otherwise initialize, stage and commit
 * against *that* repository, attributing the workspace's first commit to
 * whoever triggered the hook. With them gone, the `-c` arguments in
 * {@link commitAll} are the only source of attribution.
 *
 * **`spawn`, not `execFile`, and that is the CLI-039 fix** rather than a style
 * change. The bound has to signal the child's whole **process group**, which
 * needs the child to be in one of its own — `detached: true` — and `execFile`
 * cannot do that: it forwards a fixed subset of its options to `spawn`
 * (`cwd`, `env`, `gid`, `uid`, `shell`, `signal`, `windowsHide`,
 * `windowsVerbatimArguments`) and silently drops everything else, `detached`
 * included. The type checker refuses the option for the same reason. So the
 * collection `execFile` was providing — buffer both streams, reject on a
 * non-zero exit with `code`, `stdout` and `stderr` on the error — is done here,
 * in the shape `gitExitCode` and `gitFailure` already read.
 *
 * Two consequences of detaching, both checked rather than assumed. Output is
 * still collected, because the stdio pipes are ours either way. The child is
 * still reaped here, because it stays this process's child whatever process
 * group it is in. What does change is that a terminal's Ctrl-C no longer reaches
 * git directly — it goes to the foreground group, which the child has left — so
 * an interrupted `corpus init` ends its git child through the bound rather than
 * instantly. That is a second or two of a `git commit` on the way out, weighed
 * against the unsupervised repack CLI-039 was filed for.
 *
 * **stdin is `/dev/null`, deliberately.** `execFile` left it an open pipe it
 * never wrote to, so a git that read stdin blocked until the bound expired. A
 * detached child cannot read the terminal at all without being stopped by
 * `SIGTTIN`, which would turn a credential or editor prompt into a two-minute
 * hang. Closed stdin makes it an immediate EOF and an ordinary git error, which
 * is the failure §4 promises to report.
 */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: sanitizeGitEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const done = boundToGroup(child.pid);

    // A spawn that never started — git missing from PATH — is `requireGit`'s
    // case and must reach it unchanged, so the error is passed through as it is.
    child.on("error", (error) => {
      done();
      reject(error);
    });

    // `close` rather than `exit`: it fires once both pipes have ended, so the
    // buffers below are complete. `exit` can arrive with output still in flight.
    child.on("close", (code, signal) => {
      done();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(gitChildFailure(args, code, signal, stdout, stderr));
    });
  });

/**
 * The rejection shape `execFile` produced, rebuilt so every existing reader
 * keeps working: `gitExitCode` reads a **numeric** `code`, `gitFailure` reads
 * `stderr`, and `hasStagedChanges` branches on `code === 1` to tell
 * `diff --cached --quiet`'s answer from a failure.
 *
 * A child ended by a signal carries `killed` and `signal` and **no numeric
 * code**, exactly as before — which is what stops a group killed at the bound
 * from being mistaken for `git diff`'s "there are staged changes" exit 1.
 */
function gitChildFailure(
  args: readonly string[],
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): Error {
  return Object.assign(
    new Error(`Command failed: git ${args.join(" ")}\n${stderr}`),
    { stdout, stderr },
    signal === null ? { code } : { killed: true, signal },
  );
}

/**
 * Starts {@link GIT_TIMEOUT_MS} against a running child's **process group** and
 * returns the disposer that stands the bound down.
 *
 * `process.kill(-pid)` addresses the group whose leader is `pid`, which is the
 * group `detached: true` created. Every descendant git forks into it is
 * signalled with it, which is the whole difference from `child.kill()`.
 *
 * The escalation timer is `unref`ed so a grace period still pending cannot hold
 * a finished CLI open, and both timers are cleared by the disposer so an
 * ordinary, fast git call leaves nothing behind.
 */
function boundToGroup(pid: number | undefined): () => void {
  if (pid === undefined) return () => undefined;

  let escalation: NodeJS.Timeout | undefined;
  const expiry = setTimeout(() => {
    signalGroup(pid, "SIGTERM");
    escalation = setTimeout(() => {
      signalGroup(pid, "SIGKILL");
    }, GIT_KILL_GRACE_MS);
    escalation.unref();
  }, GIT_TIMEOUT_MS);

  return () => {
    clearTimeout(expiry);
    if (escalation !== undefined) clearTimeout(escalation);
  };
}

/**
 * Signals a whole process group, tolerating the race in which it has already
 * gone.
 *
 * `ESRCH` means the group ended between the timer firing and the signal being
 * sent, which is a success rather than a failure — and throwing here would be
 * throwing from a timer callback, where nothing can catch it.
 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone. Nothing to bound.
  }
}

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
