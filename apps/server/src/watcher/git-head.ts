// Reading the last committed version of a file (SPEC.md §6, out-of-band
// catch-all).
//
// **Read-only, deliberately.** The watcher needs `oldBody` to reconcile anchors
// against, and git already stores exactly that. It does not become a second git
// *writer*: auto-commit with acting-party authorship is a property of the write
// path (§4, Architecture Decision 2), and a watcher that committed on its own
// would be the duplication the sole-writer rule forbids. Committing the
// reconciled frontmatter is SERVER-005's (sprint-004 Adjudication 3).
//
// **HEAD-pinned and synchronous on purpose.** The ref-parameterised form lives in
// `git/show.ts` and goes through the async `Git` command builder; this one cannot,
// because the watcher's `flush()` is synchronous and its time budget
// (`WATCH_FLUSH_BUDGET_MS`) is measured against exactly this call. Two spellings
// of one question because they answer it for two schedulers — not a copy.
//
// **It does not close §4's commit window, and must not** (SERVER-093's sweep).
// The read-back rule is about operations that *name, read or revert a commit*;
// this names none — it asks for a path's bytes at `HEAD`, and a window close
// rewrites a subject, never a tree, so closing could not change the answer by a
// single byte. §4 also says the opposite in as many words: an out-of-band edit
// "closes the agent's window if one is open, then joins — or opens — the user's",
// so ending the window here would defeat the very paragraph this module serves.
// And it is structurally impossible besides: `withClosedWindow` is async and this
// runs inside a synchronous flush with a 100 ms budget.

import { execFileSync } from "node:child_process";
import { sanitizeGitEnv } from "../git/env.js";

/** Enough for any hand-written document; a blob past it is not something we reconcile. */
export const MAX_HEAD_BLOB_BYTES = 16 * 1024 * 1024;

/**
 * A `git show` that hangs must not hold a watcher batch — and the answer is
 * optional anyway.
 *
 * This is `execFileSync`, so the timeout is also a blocking budget: nothing else
 * in the process runs while it counts down. It bounds **one** read; bounding a
 * *batch* of them is `WATCH_FLUSH_BUDGET_MS`'s job, and this value is the
 * overrun term of that bound — the flush checks its budget between entries, so
 * the entry already in flight when the budget expires may still cost this much.
 */
export const GIT_TIMEOUT_MS = 5000;

export type ReadHeadVersion = (workspaceRoot: string, relativePath: string) => string | null;

/**
 * The committed content of a workspace-relative path, or `null` when there is
 * none — an untracked file, a workspace whose repository has no commits yet, or
 * no repository at all. All three are ordinary states of a real workspace
 * (`corpus init` before its first commit is the obvious one), so they are
 * answered rather than raised.
 *
 * The `HEAD:./path` spelling resolves the path against the process's working
 * directory rather than the repository root, which is what makes this correct
 * for a workspace nested inside a larger repository.
 */
export const readHeadVersion: ReadHeadVersion = (workspaceRoot, relativePath) => {
  try {
    return execFileSync("git", ["show", `HEAD:./${relativePath}`], {
      cwd: workspaceRoot,
      // Without this the read inherits `GIT_DIR`/`GIT_WORK_TREE` from whatever
      // started the server — a git hook exports them — and `oldBody` would come
      // from a foreign repository. Sprint-005 Open Conflict 6: every git child
      // in `apps/server` runs sanitized, reads included.
      env: sanitizeGitEnv(),
      encoding: "utf8",
      maxBuffer: MAX_HEAD_BLOB_BYTES,
      timeout: GIT_TIMEOUT_MS,
      // git narrates "path does not exist in HEAD" on stderr; the exit code
      // already says it, and inheriting the stream would pollute the server log.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};
