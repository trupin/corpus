import type { ReactElement } from "react";

/**
 * The `Document / Comments` switch in the reader's header (SPEC.md §11, rider
 * signed 2026-08-04): *"A document's comments are also available as a **list**,
 * reached by a Document / Comments switch in the reader's header and present in
 * both column view and full screen."*
 *
 * **It is the 💬 button, now a two-state toggle** — the same element, the same
 * place, the same width, pressed while the list is showing. That is not a
 * shortcut: it is what the head can hold, and the number is measured.
 *
 * `Reader.css`'s head block records UI-135: a row where nothing could shrink
 * overflowed its column by 97px and clipped ⋯ and ⤢ away, and the rule that came
 * out of it is that controls never yield and variable text does. So a control
 * added to this row is paid for out of the back label and the document id,
 * permanently. A segmented two-position switch was built first and measured with
 * `e2e/reader-head-geometry.spec.ts`: at 560px with a long parent title the head
 * has **45px** of slack, and the segmented control wanted 73px plus its 9px gap.
 * It overflowed the 240px column by 29px and truncated the document id at 560px
 * — the exact defect v0.15.0 was named for. One toggle costs exactly what 💬
 * cost, which is the only budget available.
 *
 * **It renders under 💬's own condition, plus one.** 💬 appeared only on a
 * document that had conversations, and the head's slack is measured against a
 * head without it; making it unconditional is the change that does not fit. So
 * the toggle appears when there is something to list, **and** whenever the list
 * is showing, so the way back is never missing. A document with no comments
 * reaches the list through the reader's ⋯ menu, where the document's own actions
 * already live — which costs the row nothing.
 *
 * **Nothing here resizes because of what it holds** (SHARED-057): the count sits
 * in the reserved two-character box UI-134 gave it, and the pressed state changes
 * colour rather than content, so toggling moves no neighbour.
 */

export type ReaderTab = "document" | "comments";

export const DOCUMENT_TAB_LABEL = "Document";
export const COMMENTS_TAB_LABEL = "Comments";

/** What the control is called in each of its two states, count and all. */
export function commentsSwitchLabel(tab: ReaderTab, count: number): string {
  const comments = `${String(count)} comment${count === 1 ? "" : "s"} on this document`;
  return tab === "comments"
    ? `${COMMENTS_TAB_LABEL} — showing the list of ${comments}. Back to the document`
    : `${COMMENTS_TAB_LABEL} — ${comments}`;
}

export interface CommentsSwitchProps {
  readonly tab: ReaderTab;
  /** How many conversations the document has. */
  readonly count: number;
  readonly onTab: (tab: ReaderTab) => void;
}

export function CommentsSwitch({ tab, count, onTab }: CommentsSwitchProps): ReactElement {
  const showing = tab === "comments";
  const label = commentsSwitchLabel(tab, count);
  return (
    <button
      type="button"
      className={showing ? "comments-btn on" : "comments-btn"}
      data-doc-tabs
      data-tab={tab}
      aria-pressed={showing}
      aria-label={label}
      title={label}
      onClick={() => {
        onTab(showing ? "document" : "comments");
      }}
    >
      {/* The count is its own box, so crossing into two digits does not widen
          the control and re-cut `.back` and `.reader-id` beside it (SPEC.md
          §11's rider; `.comments-count` carries the reservation). */}
      💬 <span className="comments-count">{count}</span>
    </button>
  );
}
