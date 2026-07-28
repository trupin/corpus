import type { Lock } from "@corpus/contract";
import { useBreakLock, type RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";

/**
 * The sepia lock banner and its Force unlock (SPEC.md §7).
 *
 * While the agent holds a document's edit lock the document renders read-only
 * with a banner naming the holder, and Force unlock is the human escape hatch:
 * it breaks the lock immediately and the break is recorded in the audit trail.
 *
 * **The toast reports what the server said, not what the button hoped.** It
 * fires on the response, never optimistically: a UI that cleared the banner
 * first eventually tells somebody a lock was broken when it was not, and that
 * is the one thing a lock UI must never do.
 *
 * It also claims **only what the response carries**. `ReleaseLockResult` is
 * `{docId, released, holder}` — so the audit-trail sentence is the server's own
 * documented behaviour for this route, while the deferred edit this toast used
 * to promise had been re-queued is not on the wire in any form. It was asserted
 * unconditionally and observed firing on a lock with nothing deferred at all
 * (sprint-010 FIND-2). Restoring the clause needs a field on the response
 * saying what was re-queued, not a sentence here hoping it was.
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
                  "The break is recorded in the audit trail.",
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
