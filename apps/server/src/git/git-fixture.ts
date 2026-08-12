import type { AutoCommitter, CommitOutcome, CommitRequest, WindowCloseReason } from "./commit.js";

/**
 * A recording stand-in for the server's one git writer (SPEC.md §4), for tests
 * that assert *what would have been committed* — and which window closes were
 * asked for — without needing a repository on disk.
 *
 * It lives beside the writer it doubles rather than beside any one caller: the
 * document write path, the thread surface and `window-lifecycle` all assert
 * against the same recording, and a fixture owned by one of them would make the
 * others import across features. (It sat under `locks/` until SERVER-099 deleted
 * that subsystem; it was never about locks.)
 */

/** The outcome a test gets unless it asks for a failure. */
export const FIXTURE_COMMIT: CommitOutcome = { kind: "committed", sha: "0123456789abcdef" };

export interface RecordingCommitter extends AutoCommitter {
  /** Every request handed to `commit`, in order. */
  readonly commits: CommitRequest[];
  /** Every sha §4's acknowledgment took out of the open commit window, in order. */
  readonly sealed: string[];
  /**
   * Every reason §4's commit window was asked to close for, in order. What a
   * close *does* is the real committer's business (SERVER-091); what a caller
   * owes is the call, and that is what this records.
   */
  readonly closed: WindowCloseReason[];
  /** Makes the next commits report `next` — a hookless workspace, a refusing hook. */
  setOutcome(next: CommitOutcome): void;
}

export function createRecordingCommitter(): RecordingCommitter {
  const commits: CommitRequest[] = [];
  const sealed: string[] = [];
  const closed: WindowCloseReason[] = [];
  let outcome: CommitOutcome = FIXTURE_COMMIT;
  const withGitLock = <T>(run: () => Promise<T>): Promise<T> => run();
  return {
    commits,
    sealed,
    closed,
    setOutcome(next) {
      outcome = next;
    },
    closeWindow(reason) {
      closed.push(reason);
      return Promise.resolve();
    },
    withClosedWindow(reason, read) {
      closed.push(reason);
      return withGitLock(read);
    },
    endSquashSession(sha) {
      sealed.push(sha);
    },
    commit: (request) =>
      withGitLock(() => {
        commits.push(request);
        return Promise.resolve(outcome);
      }),
    withGitLock,
  };
}
