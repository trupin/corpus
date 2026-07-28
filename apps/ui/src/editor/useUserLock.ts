import { useAcquireLock, useCorpusClient, useReleaseLock } from "@corpus/kit";
import { useCallback, useEffect, useRef } from "react";

/**
 * The user's half of SPEC.md §7: *"the user's editor session holds the lock
 * while actively editing (acquired via the server on first keystroke, released
 * on idle/close); the orchestrator defers edits to user-locked documents — the
 * work stays queued and applies when the lock clears."*
 *
 * Until this existed, only the agent ever took a lock. The consequence was not
 * cosmetic: with nothing to defer *on*, an agent job could rewrite a paragraph
 * out from under a person mid-sentence, and the queue's whole deferral rule was
 * unreachable code.
 *
 * **On the first keystroke, not on focus.** Opening a document to read it is
 * not editing, and a lock taken by every click would make the agent defer
 * against readers.
 *
 * **Renewed while focused, released on blur or idle.** The lease is short
 * enough that a crashed tab frees the document (the server reaps it), so a real
 * editing session has to keep saying it is still here. A `409` — the agent got
 * there first — is swallowed: the document is already read-only behind the lock
 * banner, and a toast about it would be noise on top of a banner.
 */

/** Lease length. Comfortably longer than the heartbeat, short enough to reap. */
export const LOCK_TTL_SECONDS = 300;

/** How often a focused session renews. A third of the lease: two may be missed. */
export const LOCK_HEARTBEAT_MS = 90_000;

/** No keystroke for this long and the document goes back, even while focused. */
export const LOCK_IDLE_RELEASE_MS = 10_000;

export interface UseUserLockOptions {
  readonly docId: string;
  /** False under a foreign lock or on a read-only surface: never take one then. */
  readonly enabled: boolean;
}

export interface UserLock {
  /** Called on every local keystroke; takes the lock the first time. */
  readonly touch: () => void;
  /** Called when the editor loses focus. */
  readonly blur: () => void;
}

export function useUserLock({ docId, enabled }: UseUserLockOptions): UserLock {
  const acquire = useAcquireLock();
  const release = useReleaseLock();
  const client = useCorpusClient();

  const held = useRef(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acquireRef = useRef(acquire.mutateAsync);
  acquireRef.current = acquire.mutateAsync;
  const releaseRef = useRef(release.mutateAsync);
  releaseRef.current = release.mutateAsync;
  const isEnabled = useRef(enabled);
  isEnabled.current = enabled;

  const stopTimers = useCallback((): void => {
    if (heartbeat.current !== null) clearInterval(heartbeat.current);
    if (idle.current !== null) clearTimeout(idle.current);
    heartbeat.current = null;
    idle.current = null;
  }, []);

  const giveBack = useCallback(
    (id: string): void => {
      stopTimers();
      if (!held.current) return;
      held.current = false;
      // A release that fails because the lock is already gone has reached the
      // state it was asking for; nothing to report.
      void releaseRef.current(id).catch(() => undefined);
    },
    [stopTimers],
  );

  /**
   * Hands back a grant that arrived after the session had already ended.
   *
   * Every path that stops holding the lock (blur, idle, unmount, a foreign lock
   * arriving) releases it — but a release issued while the acquire is still on
   * the wire loses the race: the grant lands afterwards and the document stays
   * locked, against a surface nobody is looking at, until the lease is reaped.
   *
   * Through the client rather than the mutation, because this is reached from
   * an unmounted component as often as from a live one.
   */
  const returnGrant = useCallback(
    (id: string): void => {
      void client.releaseLock(id).catch(() => undefined);
    },
    [client],
  );

  const touch = useCallback((): void => {
    if (!isEnabled.current || docId === "") return;

    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      idle.current = null;
      giveBack(docId);
    }, LOCK_IDLE_RELEASE_MS);

    if (held.current) return;
    held.current = true;
    void acquireRef
      .current({ docId, ttlSeconds: LOCK_TTL_SECONDS })
      .then(() => {
        // `held` is the liveness flag, re-read here and not before the request:
        // a heartbeat installed past a blur or an unmount re-acquires the lock
        // every 90 s forever — an interval nothing owns any more, which would
        // undo even an explicit `corpus lock break` within the minute.
        if (!held.current) {
          returnGrant(docId);
          return;
        }
        if (heartbeat.current !== null) return;
        heartbeat.current = setInterval(() => {
          // Re-acquiring a lock already held renews its lease — the same call,
          // which is why there is no separate heartbeat route.
          void acquireRef
            .current({ docId, ttlSeconds: LOCK_TTL_SECONDS })
            .then(() => {
              // The same race one lease later: the renewal may land after the
              // session ended, and a renewed lease is just as stuck.
              if (!held.current) returnGrant(docId);
            })
            .catch(() => undefined);
        }, LOCK_HEARTBEAT_MS);
      })
      .catch(() => {
        // Refused (409): the other party holds it. Stop claiming to.
        held.current = false;
        stopTimers();
      });
  }, [docId, giveBack, returnGrant, stopTimers]);

  const blur = useCallback((): void => {
    giveBack(docId);
  }, [docId, giveBack]);

  /**
   * Unmount and document switch both give the lock back.
   *
   * Through the client rather than the mutation: a mutation whose component has
   * unmounted may never run its effect, and a lock left behind by a closed tab
   * blocks the agent until the lease expires.
   */
  useEffect(() => {
    const id = docId;
    return () => {
      stopTimers();
      if (!held.current) return;
      held.current = false;
      void client.releaseLock(id).catch(() => undefined);
    };
  }, [client, docId, stopTimers]);

  // Losing the right to edit (a foreign lock arrived, the surface went
  // read-only) is also a reason to stop holding one.
  useEffect(() => {
    if (!enabled) giveBack(docId);
  }, [docId, enabled, giveBack]);

  /**
   * A closed tab is a closed editing session (SPEC.md §7's "released on
   * idle/close").
   *
   * Best effort, and honestly so: a browser may kill the request as the page
   * goes away, which is exactly why the lease has a TTL and `corpus lock reap`
   * exists. Without this the lock survives until that TTL expires, and the
   * agent defers to a tab nobody has open — observed, and it is a five-minute
   * stall for no reason.
   */
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") giveBack(docId);
    };
    const onPageHide = (): void => {
      giveBack(docId);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [docId, giveBack]);

  return { touch, blur };
}
