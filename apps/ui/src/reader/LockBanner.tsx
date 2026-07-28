import type { Lock } from "@corpus/contract";
import { useBreakLock, type RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";

/**
 * The sepia lock banner and its Force unlock (SPEC.md §7).
 *
 * While the agent holds a document's edit lock the document renders read-only
 * with a banner naming the holder, and Force unlock is the human escape hatch:
 * it breaks the lock immediately, the break is recorded in the audit trail, and
 * the agent's deferred edit re-enters the queue rather than being lost.
 *
 * **The toast reports what the server said, not what the button hoped.** Both of
 * those claims are the server's to make — `forceBreak` writes the audit commit
 * and re-queues the deferred event — so the success copy fires on the response
 * and the failure copy fires on the failure. A UI that clears the banner
 * optimistically eventually tells somebody a lock was broken when it was not,
 * and that is the one thing a lock UI must never do.
 */

export interface LockBannerProps {
  readonly lock: Lock;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * What the banner says the holder is doing.
 *
 * The prototype writes a free-text note here ("re-running the payoff table").
 * **The wire carries no such field** — `Lock` is `{docId, holder, acquired,
 * ttl}` — so rather than inventing a sentence, the banner states the two facts
 * it actually has: who holds it and since when. A `Lock.note` rider would make
 * the prototype's copy true; until then this is the honest version.
 */
export function lockNote(lock: Lock, now: Date = new Date()): string {
  const acquired = Date.parse(lock.acquired);
  if (Number.isNaN(acquired)) return "holding this document's edit lock";
  const seconds = Math.max(0, Math.round((now.getTime() - acquired) / 1000));
  if (seconds < 60) return "holding the edit lock, started just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `holding the edit lock for ${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  return `holding the edit lock for ${String(hours)} h`;
}

export function LockBanner({ lock, onNotify }: LockBannerProps): ReactElement {
  const breakLock = useBreakLock();

  return (
    <div className="lock-banner" role="status" data-lock-holder={lock.holder}>
      <span className="working-dot" aria-hidden="true" />
      <span>
        <b>{lock.holder} is editing</b> — {lockNote(lock)} · document is read-only
      </span>
      <button
        type="button"
        disabled={breakLock.isPending}
        onClick={() => {
          breakLock.mutate(lock.docId, {
            onSuccess: (result) => {
              onNotify({
                tone: "info",
                message:
                  `Lock broken — ${result.holder}'s lock on ${result.docId} was force-released. ` +
                  "The break is recorded in the audit trail and the agent's deferred edit was re-queued.",
              });
            },
            onError: (error) => {
              onNotify({
                tone: "error",
                message: `Force unlock failed — ${error.message}. The lock state has been refreshed.`,
              });
            },
          });
        }}
      >
        {breakLock.isPending ? "Breaking…" : "Force unlock"}
      </button>
    </div>
  );
}
