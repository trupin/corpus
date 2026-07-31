import type { DocRow } from "@corpus/contract";
import { useRef, type ReactElement } from "react";
import { useRovingMenu } from "../menu/useRovingMenu";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";
import { usePopoverShift } from "./popover";

/**
 * The 💬 popover: every thread on this document, one line each
 * (`design/index.html`'s `.comments-pop` / `.cp-item`).
 *
 * Rendered from the rows `GET /api/docs?parent=<id>&type=thread` already
 * returned — one request for the whole list, and the same rows the board's
 * thread rows are built from, so the turn counts and statuses here can never
 * disagree with the ones a column shows.
 *
 * It is the same kind of surface as the ⋯ menu and gets the same keyboard
 * behaviour from the same {@link useRovingMenu} (UI-030) — arrows between the
 * threads, `↵` to open one, Tab or `esc` to dismiss, focus back on the 💬
 * button. With no threads there is nothing to rove: the empty line is not an
 * item, and the hook leaves focus on the container so `esc` still lands.
 */

export interface CommentsPopoverProps {
  readonly threads: readonly DocRow[];
  readonly onSelect: (threadId: string) => void;
  readonly onClose: () => void;
}

/** The prototype's meta line: `2 turns · last: agent · open`. */
export function threadMeta(row: DocRow): string {
  const count = row.turnCount ?? 0;
  const last = row.lastAuthor ?? "—";
  return `${String(count)} turn${count === 1 ? "" : "s"} · last: ${last} · ${row.status}`;
}

/** The prototype's quote line: the anchored text, or what kind of thread it is. */
export function threadQuote(row: DocRow): string {
  const quote = row.anchorQuote?.trim() ?? "";
  return quote === "" ? "whole-document thread" : `“${quote}”`;
}

export function CommentsPopover({
  threads,
  onSelect,
  onClose,
}: CommentsPopoverProps): ReactElement {
  const pop = useRef<HTMLDivElement>(null);
  const shift = usePopoverShift(pop, true);
  const roving = useRovingMenu(pop, { onDismiss: onClose });
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  return (
    <div
      ref={pop}
      className="comments-pop open"
      role="menu"
      aria-label="Threads on this document"
      style={shift === 0 ? undefined : { transform: `translateX(${String(-shift)}px)` }}
      {...roving}
    >
      {threads.length === 0 ? (
        <div className="cp-meta cp-empty">
          No threads on this document yet — select some text to start one.
        </div>
      ) : (
        threads.map((row) => (
          <button
            key={row.id}
            type="button"
            className="cp-item"
            role="menuitem"
            data-cp-item={row.id}
            onClick={() => {
              onSelect(row.id);
            }}
          >
            <div className="cp-quote">{threadQuote(row)}</div>
            <div className="cp-meta">{threadMeta(row)}</div>
          </button>
        ))
      )}
    </div>
  );
}
