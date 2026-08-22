// The resolve/reopen confirmations (SPEC.md §11 — a mutation's outcome is
// reported honestly), in one module because three surfaces report the same
// write: the thread card's head, the conversation panel's menu, and the
// document menu's ⋯ set.
//
// **Why one constant and not three literals** (UI-078). The second sentence
// below is not copy — it is a claim about the *server's* write path, and it was
// false for months while the literal sat duplicated in three files with nothing
// asserting it against anything. `scripts/resolve-notice-promise.test.ts` now
// runs it through `apps/server/src/threads/participation.ts`, the one function
// that decides what a turn does to a thread's `status`, and fails if either side
// moves. A string spelled out three times cannot be pinned by one test, and the
// duplication is itself how the two would drift apart again.
//
// **Why it says no more than it does** — the question UI-078 asks, decided
// against widening. Since §8's signed rider ("Resolved is a closed door, not a
// locked one") a person's reply reopens a resolved thread in *every* case, and
// what the reply additionally does splits three ways: it reaches the agent on a
// thread the agent is engaged in, reaches nobody when posted "note only", and
// enqueues nothing on a thread the agent was never in. None of those three is a
// consequence of resolving. They are §8's ordinary rules, which read exactly the
// same before the resolve and after it — so naming them here would describe the
// baseline rather than the change this notice confirms. The control that picks
// between them is the composer's own `◉ ask agent` / `○ note only` toggle, which
// sits beside the field at the moment the choice is actually made and already
// carries the matching `reopens on reply` hint (see `ThreadComposer.tsx`). A
// confirmation is read at a glance, once, at the moment a person is *not*
// replying; spending it on a matrix they cannot act on yet buys nothing and
// costs the one sentence that matters — that this door is not locked.

/**
 * Shown when a thread is resolved.
 *
 * Its second sentence is a promise about the write path, pinned by
 * `scripts/resolve-notice-promise.test.ts`. Do not weaken it to a hedge
 * ("replying may reopen it") without changing what the server does — an honest
 * report of a definite behaviour is the point.
 */
export const THREAD_RESOLVED_NOTICE = "Thread resolved — committed. Replying reopens it.";

/** Shown when a thread is reopened by hand. */
export const THREAD_REOPENED_NOTICE = "Thread reopened — committed.";

/**
 * The notice for a status flip, keyed on what was **sent** rather than on the
 * render's own `resolved` — the callbacks these feed outlive the surface that
 * started the write (UI-012, UI-015).
 */
export function threadStatusNotice(resolved: boolean): string {
  return resolved ? THREAD_RESOLVED_NOTICE : THREAD_REOPENED_NOTICE;
}
