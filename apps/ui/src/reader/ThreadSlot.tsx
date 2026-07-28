import type { DocRow } from "@corpus/contract";
import { useMarkThreadSeen, useThread } from "@corpus/kit";
import { useEffect, useRef, type ReactElement } from "react";
import { TurnList } from "./Turns";

/**
 * One thread on the open document, collapsed to the prototype's `.t-chip` and
 * expanding inline into its `.thread-card`.
 *
 * SPEC.md §11: "in narrow columns they collapse to chips at the anchor that
 * expand inline". The chips sit below the body rather than *at* the anchor,
 * because placing them at the anchor means splitting the rendered body at the
 * resolved character ranges — which is the editor's job and arrives with UI-006,
 * whose TipTap document owns those ranges. Whole-document and orphaned threads
 * belong below the body in any case (SPEC.md §11).
 *
 * **Expanding marks the thread seen, opening the parent does not.** That is
 * SPEC.md §7's rule stated exactly: what counts as read is displayed content
 * only, and a collapsed chip has displayed nothing.
 */

export interface ThreadSlotProps {
  readonly row: DocRow;
  readonly expanded: boolean;
  /** True for ~1.2s after the 💬 popover selected this thread. */
  readonly flashing: boolean;
  readonly onToggle: () => void;
  readonly onOpenRef: (docId: string) => void;
  /** The thread-context link: opens the thread as a document, pushing the stack. */
  readonly onOpenThread: (threadId: string) => void;
}

export function ThreadSlot({
  row,
  expanded,
  flashing,
  onToggle,
  onOpenRef,
  onOpenThread,
}: ThreadSlotProps): ReactElement {
  // Fetched only once the card is actually on screen: a document with a dozen
  // threads must not pull a dozen conversations to render a dozen chips.
  const thread = useThread(expanded ? row.id : undefined);
  const markSeen = useMarkThreadSeen();
  const seen = useRef(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || seen.current || row.unread !== true) return;
    seen.current = true;
    markSeen.mutate(row.id);
  }, [expanded, markSeen, row.id, row.unread]);

  useEffect(() => {
    if (!flashing || card.current === null) return;
    // jsdom implements no layout and therefore no `scrollIntoView`.
    if (typeof card.current.scrollIntoView === "function") {
      card.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flashing]);

  const quote = row.anchorQuote?.trim() ?? "";
  const turns = row.turnCount ?? 0;
  const chipLabel = quote === "" ? "whole-document thread" : `“${quote}”`;

  return (
    <div className={expanded ? "thread-slot expanded" : "thread-slot"} data-slot-thread={row.id}>
      <button
        type="button"
        className={row.status === "resolved" ? "t-chip resolved-chip" : "t-chip"}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        💬 {String(turns)} · {chipLabel}
      </button>
      <div
        ref={card}
        className={[
          "thread-card",
          row.status === "resolved" ? "resolved" : "",
          flashing ? "flash" : "",
        ]
          .filter((part) => part !== "")
          .join(" ")}
        data-thread={row.id}
      >
        <div className="t-head">
          {quote === "" ? null : <span className="t-quote">“{quote}”</span>}
          <span className="t-status chip">{row.status}</span>
        </div>
        <div className="t-context">
          <button
            type="button"
            className="ref"
            onClick={() => {
              onOpenThread(row.id);
            }}
          >
            open thread {row.id}
          </button>
        </div>
        <button
          type="button"
          className="t-collapse"
          aria-label="Collapse thread"
          onClick={onToggle}
        >
          ✕
        </button>
        {thread.isPending ? (
          <p className="turn-empty">Loading…</p>
        ) : thread.error !== null ? (
          <p className="turn-empty" role="alert">
            {thread.error.message}
          </p>
        ) : (
          <TurnList turns={thread.data?.turns ?? []} onOpenRef={onOpenRef} />
        )}
      </div>
    </div>
  );
}
