/**
 * `r` — "focus the reply composer of the open document's visible thread"
 * (SPEC.md §11).
 *
 * **Expressed against the DOM on purpose.** Every other binding acts on state;
 * this one acts on *focus*, and focus is a DOM fact. The alternative — threading
 * an imperative `focusReply` from the shell through the board, the column, the
 * reader, the document view and the thread slot to the composer's input — is six
 * components learning about a keystroke none of them otherwise cares about.
 *
 * The auto-expansion is deliberate and its side effect is intended: expanding a
 * thread renders its conversation, and SPEC.md §7 counts displayed content as
 * read, so `r` on a document whose threads are all collapsed does mark the first
 * one seen. That is the same thing clicking the collapsed line does, which is
 * what the user just asked for by a faster route.
 *
 * **It keeps working now that folds are sticky and by-rule** (UI-077). SPEC.md
 * §11's rider requires exactly that of the existing `r` binding, and the fallback
 * below is what delivers it: a document whose only conversation is a resolved
 * one, folded by the rule, still has a composer one activation away.
 */

export type ReplyFocusResult =
  /** A composer was already on screen and now has the caret. */
  | "focused"
  /** No thread was expanded; the first one was opened and its composer focused. */
  | "expanded"
  /** The document has no threads — the caller says so rather than doing nothing. */
  | "none";

/**
 * The reading surface `r` applies to: focus mode when it is up, otherwise the
 * active column's reader. Focus mode is a full-viewport overlay over the board,
 * so a thread the user can see there is the thread they mean.
 */
export function replyRoot(board: HTMLElement | null, columnId: string | null): HTMLElement | null {
  const focus = document.querySelector<HTMLElement>(".focus.open");
  if (focus !== null) return focus;
  if (board === null || columnId === null) return null;
  return board.querySelector<HTMLElement>(`.reader[data-reader-column="${columnId}"]`);
}

/** Deferred so the composer that a chip click is about to render can be focused. */
export type Scheduler = (run: () => void) => void;

const defaultSchedule: Scheduler = (run) => {
  setTimeout(run, 0);
};

function focusComposer(root: HTMLElement): boolean {
  const composer = root.querySelector<HTMLElement>("[data-composer]");
  if (composer === null) return false;
  composer.focus();
  if (typeof composer.scrollIntoView === "function") {
    composer.scrollIntoView({ block: "nearest" });
  }
  return true;
}

export function focusReplyComposer(
  root: HTMLElement | null,
  schedule: Scheduler = defaultSchedule,
): ReplyFocusResult {
  if (root === null) return "none";
  if (focusComposer(root)) return "focused";

  // The collapsed line, wherever it is placed — a chip at an anchor, a folded
  // card in the margin, a thread listed below the body. One marker, because
  // there is one collapsed representation (SPEC.md §11).
  const chip = root.querySelector<HTMLElement>("[data-thread-expand]");
  if (chip === null) return "none";
  chip.click();
  schedule(() => {
    focusComposer(root);
  });
  return "expanded";
}
