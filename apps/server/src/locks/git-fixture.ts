// A recording stand-in for the server's one git writer, for the lock tests.
//
// Only the force-break audit entry reaches git from here, and what matters
// about it is *what would have been committed* — the subject, the actor, the
// trailer naming the broken lease, and that it asked for an empty commit. A real
// repository would prove none of that more clearly and would make every lock
// test spawn git.

import type { AutoCommitter, CommitOutcome, CommitRequest } from "../git/index.js";

/** The outcome a lock test gets unless it asks for a failure. */
export const FIXTURE_COMMIT: CommitOutcome = { kind: "committed", sha: "0123456789abcdef" };

export interface RecordingCommitter extends AutoCommitter {
  /** Every request handed to `commit`, in order. */
  readonly commits: CommitRequest[];
  /** Every sha §4's acknowledgment took out of the squash session, in order. */
  readonly sealed: string[];
  /** Makes the next commits report `next` — a hookless workspace, a refusing hook. */
  setOutcome(next: CommitOutcome): void;
}

export function createRecordingCommitter(): RecordingCommitter {
  const commits: CommitRequest[] = [];
  const sealed: string[] = [];
  let outcome: CommitOutcome = FIXTURE_COMMIT;
  // The real committer runs every commit inside its own `.git/index` lock and so
  // does this one — nothing here contends, so running inline keeps the tests'
  // ordering identical to the caller's.
  const withGitLock = <T>(run: () => Promise<T>): Promise<T> => run();
  return {
    commits,
    sealed,
    setOutcome(next) {
      outcome = next;
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
