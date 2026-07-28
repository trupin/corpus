import type { DocRow } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { ThreadCard } from "../thread/ThreadCard";

/**
 * One thread on the open document, collapsed to the prototype's `.t-chip` and
 * expanding inline into its `.thread-card`.
 *
 * SPEC.md §11: "in narrow columns they collapse to chips at the anchor that
 * expand inline". The chips sit below the body rather than *at* the anchor,
 * because placing them at the anchor means splitting the rendered body at the
 * resolved character ranges — which is the editor's job (UI-006/UI-007).
 * Whole-document and orphaned threads belong below the body in any case
 * (SPEC.md §11).
 *
 * **Expanding is what marks the thread seen, and opening the parent is not.**
 * That asymmetry is SPEC.md §7's rule stated exactly — what counts as read is
 * displayed content only, and a collapsed chip has displayed nothing. It is
 * enforced by the card being *unmounted* while collapsed rather than hidden:
 * the mark rides on the card, so there is no way to render the conversation
 * without recording that it was rendered, and no way to record it without.
 */

export interface ThreadSlotProps {
  readonly row: DocRow;
  readonly expanded: boolean;
  /** True for ~1.2s after the 💬 popover selected this thread. */
  readonly flashing: boolean;
  readonly onToggle: () => void;
  /** A `[[ref]]` or the context link was followed. */
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/** The chip's label: turn count, last author, and whether it is resolved. */
export function chipLabel(row: DocRow): string {
  const turns = row.turnCount ?? 0;
  const who = row.lastAuthor ?? "new";
  return `💬 ${String(turns)} · ${who}${row.status === "resolved" ? " · resolved" : ""}`;
}

export function ThreadSlot({
  row,
  expanded,
  flashing,
  onToggle,
  onOpenDoc,
  onNotify,
}: ThreadSlotProps): ReactElement {
  return (
    <div className={expanded ? "thread-slot expanded" : "thread-slot"} data-slot-thread={row.id}>
      <button
        type="button"
        className={row.status === "resolved" ? "t-chip resolved-chip" : "t-chip"}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {chipLabel(row)}
        {row.unread === true ? <span className="unread">new</span> : null}
      </button>
      {/* Mounted only while expanded: a document with a dozen threads must not
          pull a dozen conversations to render a dozen chips — and must not mark
          a dozen threads seen. */}
      {expanded ? (
        <ThreadCard
          threadId={row.id}
          host="slot"
          row={row}
          flashing={flashing}
          onCollapse={onToggle}
          onOpenDoc={onOpenDoc}
          onNotify={onNotify}
        />
      ) : null}
    </div>
  );
}
