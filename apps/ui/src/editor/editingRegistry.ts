import { useSyncExternalStore } from "react";

/**
 * Which documents somebody is typing into, right now.
 *
 * The board repaints from SSE invalidations, which is exactly right for every
 * surface except the one the user is typing in. `["docs", id]` fires on *any*
 * mutation of that document — the agent's edit, a reprojection, and the echo of
 * the user's own save — and each one refetches `useDoc(id)`. An editor that
 * simply mirrored the query would therefore replace half-typed text with the
 * server's copy, mid-keystroke, for reasons the user cannot see.
 *
 * So an editing session registers here, and the editor defers *applying* an
 * incoming body while the entry stands. The invalidation still happens; the
 * cache is still correct; what waits is the moment the editor adopts it. When
 * the entry clears — no keystroke for the idle window, no pending save, nothing
 * in flight — the deferred body is applied exactly once, and the user sees what
 * changed underneath them.
 *
 * **Keyed by document id, not global.** Doc B's invalidation must repaint doc
 * B's reader while doc A is being typed into (sprint-011 TEST-36); a global
 * "somebody is editing" flag would freeze the whole board.
 *
 * Module state rather than context because the guard is a property of the
 * document, not of one component tree: two columns showing the same document,
 * a margin card and a focus-mode overlay all have to agree about it.
 */

const editing = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Records that this document has an active editing session. Idempotent. */
export function beginEditing(docId: string): void {
  if (docId === "" || editing.has(docId)) return;
  editing.add(docId);
  notify();
}

/** Clears the session, releasing any deferred update. Idempotent. */
export function endEditing(docId: string): void {
  if (!editing.delete(docId)) return;
  notify();
}

export function isEditing(docId: string): boolean {
  return editing.has(docId);
}

/** Test seam: the registry is module state and a suite must be able to reset it. */
export function resetEditingRegistry(): void {
  if (editing.size === 0) return;
  editing.clear();
  notify();
}

/** Test seam: how many documents are being edited right now. */
export function editingCount(): number {
  return editing.size;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this document has an active editing session, as reactive state. */
export function useIsEditing(docId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => editing.has(docId),
    // The server never renders the editor, but `useSyncExternalStore` requires
    // the third argument for any tree that might hydrate.
    () => false,
  );
}
