import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The active column (SPEC.md §10: "the active column follows focus/hover with a
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
   * {@link pin}'s claim without its move: the column that is active stays
   * active, and a pointer that has not moved cannot take it.
   *
   * What a **programmatic close** uses (UI-031). Closing full screen unmounts a
   * full-viewport overlay, and the column that was underneath the resting cursor
   * the whole time then fires `mouseover` and adopts the board — a gesture the
   * user never made, which strands `esc` on a column with no reader until the
   * mouse is physically moved. The signed rule is "keep the origin column active
   * and ignore the pointer's position until it actually moves", and this is that
   * one-shot latch: the same ref `pin` arms, released by the same real
   * `mousemove`, so hover-follows-active itself is untouched.
   */
  readonly hold: () => void;
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
   *
   * Closing full screen is the same event with a different cause (UI-031), so it
   * arms the same ref through {@link ActiveColumn.hold} rather than growing a
   * second flag beside this one.
   */
  const keyboardOwns = useRef(false);

  /**
   * The release, **in the capture phase** (UI-033).
   *
   * The phase is load-bearing and it took a browser to find out. React 18
   * attaches its handlers at the root container, which is inside `document`'s
   * bubble path, so a bubble-phase listener here runs *after* the column's own
   * `onMouseMove` — which would therefore still see the latch armed and drop the
   * activation it was added to carry. Capture on `document` runs before the root
   * either way, so the latch is down by the time the column is asked.
   *
   * Nothing else changes: a re-render that slides a column under a stationary
   * cursor emits `mouseover` and no `mousemove`, so the latch still survives
   * exactly the event it exists for.
   */
  useEffect(() => {
    const release = (): void => {
      keyboardOwns.current = false;
    };
    document.addEventListener("mousemove", release, { capture: true });
    return () => {
      document.removeEventListener("mousemove", release, { capture: true });
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

  const hold = useCallback(() => {
    keyboardOwns.current = true;
  }, []);

  const pin = useCallback(
    (columnId: string) => {
      hold();
      setWanted(columnId);
    },
    [hold],
  );

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

  return { id, index, activate, pin, hold, switchBy };
}
