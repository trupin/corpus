import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The active column (SPEC.md §11: "the active column follows focus/hover with a
 * visible cue"), and `←`/`→`'s movement between columns.
 *
 * **Resolved on every render rather than stored as an index.** The board changes
 * under the keyboard — an SSE invalidation can unpin a column between one
 * keystroke and the next — and an index would then point at whichever column
 * slid into that position, or past the end. Holding the *id* and looking it up
 * each time makes a vanished column degrade to "the first column is active"
 * instead of to a crash or a silent mis-target (TEST-152).
 */

export interface ActiveColumn {
  /** `null` only when the board has no columns at all. */
  readonly id: string | null;
  /** Index of {@link id} in the given order; `0` when nothing is active yet. */
  readonly index: number;
  /**
   * Hover, focus, or a click: whatever the pointer touched is now active —
   * unless the keyboard has claimed it and the pointer has not moved since.
   */
  readonly activate: (columnId: string) => void;
  /**
   * Makes a column active *on the keyboard's authority*, which a stationary
   * pointer cannot then override. What `⇧←`/`⇧→` uses to keep the column it
   * just moved.
   */
  readonly pin: (columnId: string) => void;
  /**
   * `←`/`→` and `[`/`]`. Clamps at both ends — no wrap, because a board is a
   * strip the user is looking at, not a carousel. Returns the column that ends
   * up active so the caller can scroll it in, or `null` when nothing moved.
   */
  readonly switchBy: (delta: -1 | 1) => string | null;
}

export function useActiveColumn(columns: readonly { readonly id: string }[]): ActiveColumn {
  const [wanted, setWanted] = useState<string | null>(null);
  /**
   * Set by a keyboard act, cleared by an actual pointer movement.
   *
   * Without it, `⇧→` undoes itself: the move re-orders the DOM under a
   * stationary cursor, the column that slid into that position fires
   * `mouseover`, and the board hands the keyboard's own gesture to whichever
   * list the mouse happens to be resting on. `mousemove` is the honest
   * discriminator, because a re-render cannot forge one.
   */
  const keyboardOwns = useRef(false);

  useEffect(() => {
    const release = (): void => {
      keyboardOwns.current = false;
    };
    document.addEventListener("mousemove", release);
    return () => {
      document.removeEventListener("mousemove", release);
    };
  }, []);

  const index = Math.max(
    0,
    columns.findIndex((column) => column.id === wanted),
  );
  const id = columns[index]?.id ?? null;

  const activate = useCallback((columnId: string) => {
    if (keyboardOwns.current) return;
    setWanted(columnId);
  }, []);

  const pin = useCallback((columnId: string) => {
    keyboardOwns.current = true;
    setWanted(columnId);
  }, []);

  const switchBy = useCallback(
    (delta: -1 | 1): string | null => {
      const from = columns.findIndex((column) => column.id === id);
      if (from < 0) return null;
      const to = from + delta;
      if (to < 0 || to >= columns.length) return null;
      const next = columns[to]?.id ?? null;
      if (next !== null) pin(next);
      return next;
    },
    [columns, id, pin],
  );

  return { id, index, activate, pin, switchBy };
}
