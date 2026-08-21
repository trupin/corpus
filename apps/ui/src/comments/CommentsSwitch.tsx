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
 * **It renders under 💬's own condition, plus one — and that is a deviation from
 * §11, recorded here rather than hidden.** The rider says the list is *"reached
 * by a Document / Comments switch in the reader's header"*, with no clause about
 * the document already having conversations. Unconditional was built and
 * measured, and the head has no room for it at one width.
 *
 * The measurement, at a 560px column (534px of content) showing a document
 * reached from a long-titled parent, so `.back` sits at its own `max-width: 40%`
 * cap — `natural` is what each item would take if the row had the room:
 *
 * ```
 * .back        214 (cap)   .reader-id  101   .save-chip  120
 * .comments-btn 52         ⋯            28   ⤢            22     gaps 5 × 9 = 45
 *
 * natural total 582        content 534       deficit 48px
 * without the switch 521   content 534       slack   13px
 * ```
 *
 * So the row has **13px of slack** in that configuration and the toggle needs
 * **61px** (52 plus its gap). It is not a padding-shaving problem: no control of
 * any width fits, and the two items that would pay are the ones UI-135's log
 * records as the rejected trade — *"the back label squeezed below its own cap
 * and the document id truncating on a head where nothing unusual was
 * happening."* Drawn, the id lost 16px of 101 and the chip 19px of its
 * reservation. Every other head measured has room: the same column with an
 * ordinary back label has **114px of slack**, and both 240px cases pass.
 *
 * So the toggle appears when there is something to list, **and** whenever the
 * list is showing, so the way back is never missing. A document with no comments
 * reaches the list through the reader's ⋯ menu, where the document's own actions
 * already live — which costs the row nothing. Restoring §11's unconditional
 * reading needs room the head does not have: a shorter `.reader-id`, a smaller
 * `.back` cap, or a narrower save-chip reservation — each of them somebody
 * else's signed tuning.
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
