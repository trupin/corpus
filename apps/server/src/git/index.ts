/**
 * `git` — the server's git writer (SPEC.md §4).
 *
 * There is exactly one `execFile`-based git command builder in `apps/server`
 * and exactly one place that composes an auto-commit; every other module —
 * the document write path, SERVER-009's force-break audit entry, the watcher's
 * `git show HEAD:` read — goes through this surface.
 */

export {
  ACTOR_IDENTITIES,
  FALLBACK_COMMITTER,
  RECOVERY_AUTHOR,
  SQUASH_IDLE_MS,
  WINDOW_MAX_MS,
} from "./commit.js";
export { TRAILER_ACTOR, TRAILER_ANCHORS, TRAILER_DOC } from "./commit.js";
export { createAutoCommitter, editingSessionSubject, gitAuthorOf } from "./commit.js";
export type {
  AnchorChange,
  AutoCommitter,
  AutoCommitterOptions,
  CommitOutcome,
  CommitRequest,
  WindowCloseReason,
} from "./commit.js";
export { RECOVERY_ROOTS, recoverUncommittedChanges, recoverySubject } from "./recovery.js";
export type { BootRecoveryOptions, RecoveryOutcome } from "./recovery.js";
export { sanitizeGitEnv } from "./env.js";
export type { ChildEnv } from "./env.js";
export { disableAutoMaintenance } from "./maintenance.js";
export {
  createGit,
  gitOutput,
  GIT_TIMEOUT_MS,
  GIT_UNAVAILABLE_CODE,
  MAX_GIT_OUTPUT_BYTES,
} from "./git.js";
export type { Git, GitCommandResult, GitExecOptions } from "./git.js";
export {
  REVISION_SEARCH_LIMIT,
  listFileRevisions,
  readVersionAt,
  resolveRevision,
} from "./show.js";
