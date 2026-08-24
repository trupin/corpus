// The one `execFile`-based git command builder in `apps/server` (SPEC.md §4;
// sprint-005 Integration Point 2 — "there is exactly one git writer").
//
// Never a shell: arguments are passed as an array, so a title containing `;`,
// backticks or a newline is data, never syntax. Never an inherited environment:
// every invocation runs with `sanitizeGitEnv`, which is what keeps a server
// started from inside a git hook from committing into that hook's repository.
//
// A non-zero exit is a *result*, not an exception. Half of what this module is
// asked is a question with a legitimate "no" — is this a repository, is HEAD an
// ancestor of a remote, did a hook reject the commit — and modelling those as
// throws would put control flow in `catch` blocks.

import { execFile } from "node:child_process";
import { sanitizeGitEnv } from "./env.js";

/** Enough for `git show` of any hand-written document; git's own output is tiny. */
export const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * A commit runs the workspace's own hooks (SPEC.md §11 — "honored, never
 * bypassed"), so the budget covers a real pre-commit hook rather than a bare
 * `git commit`. A hook that hangs past this fails the commit loudly instead of
 * holding a request open forever; the file mutation still stands.
 */
export const GIT_TIMEOUT_MS = 30_000;

/** Reported when git could not be spawned at all — a workspace with no `git` on `PATH`. */
export const GIT_UNAVAILABLE_CODE = -1;

export type GitCommandResult = {
  readonly ok: boolean;
  /** The process exit code, or {@link GIT_UNAVAILABLE_CODE} when git never ran. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** False when the binary is missing; distinguishes "no git" from "git said no". */
  readonly spawned: boolean;
};

export interface GitExecOptions {
  /** Extra environment on top of the sanitized base. Used for nothing today; git identity travels as flags. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
  /**
   * Written to the command's standard input, which is then closed.
   *
   * A `Buffer` rather than only a string, because the one caller is
   * `git hash-object` recording a file's **observed bytes** (SERVER-142): a
   * document whose content survived a round trip through a JS string would be a
   * document whose commit is not byte-for-byte what was on disk.
   */
  readonly stdin?: Buffer | string | undefined;
}

export interface Git {
  /** Absolute path of the workspace; every invocation carries it as an explicit `cwd`. */
  readonly root: string;
  exec(args: readonly string[], options?: GitExecOptions): Promise<GitCommandResult>;
}

/** Combined output, trimmed — what a hook printed, in the order a terminal would show it. */
export function gitOutput(result: GitCommandResult): string {
  return [result.stdout, result.stderr]
    .map((stream) => stream.trimEnd())
    .filter((stream) => stream !== "")
    .join("\n");
}

export function createGit(root: string): Git {
  return {
    root,
    exec(args, options = {}) {
      return new Promise<GitCommandResult>((resolve) => {
        const child = execFile(
          "git",
          [...args],
          {
            cwd: root,
            env: { ...sanitizeGitEnv(), ...(options.env ?? {}) },
            encoding: "utf8",
            maxBuffer: MAX_GIT_OUTPUT_BYTES,
            timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ ok: true, code: 0, stdout, stderr, spawned: true });
              return;
            }
            // `execFile` reports a non-zero exit as a numeric `code` and a spawn
            // failure (`ENOENT` when git is not installed) as a string one.
            const raw: unknown = (error as { code?: unknown }).code;
            const spawned = typeof raw === "number";
            resolve({
              ok: false,
              code: spawned ? raw : GIT_UNAVAILABLE_CODE,
              stdout,
              stderr: stderr === "" ? error.message : stderr,
              spawned,
            });
          },
        );
        if (options.stdin !== undefined && child.stdin !== null) {
          // git can exit before it has read all of it — a rejected `hash-object`,
          // a `timeout` kill — and the write then fails with `EPIPE`. That is
          // reported through the exit code above like every other refusal, so
          // the stream's own error event must not become an unhandled one and
          // take the process down.
          child.stdin.on("error", () => {});
          child.stdin.end(options.stdin);
        }
      });
    },
  };
}
