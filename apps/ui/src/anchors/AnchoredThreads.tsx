import type { DocRow } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { summaryFromRow } from "../thread/CollapsedThread";
import { ThreadPanel } from "../thread/ThreadPanel";
import { anchoredSummary, type AnchoredThread } from "./anchorPlacement";
import "./anchors.css";

/**
 * The three places an anchored thread can be, and the one place a detached one
 * is (SPEC.md §11).
 *
 * - **A chip at its anchor**, in a narrow column — a widget between the two
 *   blocks the anchor sits between, with the real `ThreadPanel` portalled into
 *   it. This decides *where*; the panel decides whether it is folded.
 * - **A card in the margin**, in focus mode or a wide reader, cascaded beside
 *   its highlight.
 * - **Below the body**, for whole-document threads, for threads whose anchor the
 *   server could no longer resolve, and for the ones it did resolve that this
 *   view cannot point at (`anchorPlacement.segmentsOf`).
 *
 * **All three render the same component**, which is the point of UI-077: which
 * placement a thread gets depends on the width, and whether it can be collapsed
 * does not. The margin used to be the exception — it received no expansion state
 * at all, so a conversation could be folded in a narrow column and not in a wide
 * one, which is the incoherence the live report was actually about.
 */

export interface AnchorThreadsProps {
  readonly threads: readonly AnchoredThread[];
  /**
   * The document these anchors belong to — what a conversation whose row has not
   * arrived reports as its parent (`anchoredSummary`).
   */
  readonly parentId: string;
  readonly flashThread: string | null;
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export interface AnchorChipsProps extends AnchorThreadsProps {
  /** The widget element this thread's chip belongs in, or `null` in margin mode. */
  readonly hostFor: (threadId: string) => HTMLElement | null;
}

/** Chips at their anchors — rendered through the editor's widget decorations. */
export function AnchorChips({
  threads,
  parentId,
  flashThread,
  onOpenDoc,
  onNotify,
  hostFor,
}: AnchorChipsProps): ReactElement {
  return (
    <>
      {threads.map((thread) => {
        // Only the widget is a precondition here: the anchor answers for the
        // conversation while its row is missing (`anchoredSummary`), so a chip
        // is never withheld for a thread the body is already highlighting.
        const host = hostFor(thread.threadId);
        if (host === null) return null;
        return createPortal(
          <ThreadPanel
            summary={anchoredSummary(thread, parentId)}
            host="slot"
            flashing={flashThread === thread.threadId}
            onOpenDoc={onOpenDoc}
            onNotify={onNotify}
          />,
          host,
          thread.threadId,
        );
      })}
    </>
  );
}

export interface MarginColumnProps extends AnchorThreadsProps {
  readonly innerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * The margin column. Panels are absolutely positioned by `useMarginLayout`, so
 * their order in the DOM is irrelevant and their `top` is everything.
 *
 * **Every anchor gets a panel, row or no row** (PR #25 review, MINOR). Skipping
 * the ones whose row had not arrived made a conversation disappear from the
 * margin while its highlight stayed in the body — permanently, on a document
 * carrying more threads than one page of `useDocs` holds, and for a frame on
 * every first paint. `anchoredSummary` is what makes that unnecessary: the
 * anchor already says which thread it is, what passage it is about and whether
 * it is resolved, and the card fills in the rest by id.
 */
export function MarginColumn({
  threads,
  parentId,
  flashThread,
  onOpenDoc,
  onNotify,
  innerRef,
}: MarginColumnProps): ReactElement {
  return (
    <div className="focus-margin" ref={innerRef} data-anchor-margin>
      {threads.map((thread) => (
        <ThreadPanel
          key={thread.threadId}
          summary={anchoredSummary(thread, parentId)}
          host="margin"
          flashing={flashThread === thread.threadId}
          onOpenDoc={onOpenDoc}
          onNotify={onNotify}
        />
      ))}
    </div>
  );
}

export interface DetachedThreadsProps {
  readonly wholeDocument: readonly DocRow[];
  readonly orphaned: readonly DocRow[];
  /** Anchored, resolved, but with nothing on this screen to sit beside. */
  readonly unplaced?: readonly DocRow[];
  readonly flashThread: string | null;
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export const DETACHED_LABEL = "Detached threads";
export const WHOLE_DOCUMENT_LABEL = "Whole-document threads";
export const UNPLACED_LABEL = "Threads without a place in this view";

/**
 * Threads that hang off no text on this screen: the ones that never did, the
 * ones whose quote the last save removed, and the ones whose anchor is live but
 * unplaceable here.
 *
 * An orphaned thread is **not** damaged — SPEC.md §6 keeps its selector
 * byte-for-byte, so it still knows what it was about and is still fully
 * repliable. It has simply lost its place in the document, which is why it is
 * listed rather than hidden.
 *
 * The third group is separate from the second on purpose, because the two say
 * different things. "Detached" is the server's verdict about the file: the
 * quoted text is gone. "Without a place in this view" is *this screen's*
 * admission that it cannot show where a live anchor points — the quote is still
 * in the document, and the thread returns to it as soon as the view can say
 * where. Filing the second under the first would report a data loss that has not
 * happened; drawing it at the top of the margin instead, which is what used to
 * happen, reported a comment on the title (UI-062).
 */
export function DetachedThreads({
  wholeDocument,
  orphaned,
  unplaced = [],
  flashThread,
  onOpenDoc,
  onNotify,
}: DetachedThreadsProps): ReactElement | null {
  if (wholeDocument.length === 0 && orphaned.length === 0 && unplaced.length === 0) return null;

  const section = (label: string, rows: readonly DocRow[], kind: string): ReactElement | null =>
    rows.length === 0 ? null : (
      <div className="thread-slots" data-thread-section={kind}>
        <div className="slots-label">{label}</div>
        {rows.map((row) => (
          <ThreadPanel
            key={row.id}
            summary={summaryFromRow(row)}
            host="slot"
            flashing={flashThread === row.id}
            onOpenDoc={onOpenDoc}
            onNotify={onNotify}
          />
        ))}
      </div>
    );

  return (
    <>
      {section(WHOLE_DOCUMENT_LABEL, wholeDocument, "whole-document")}
      {section(UNPLACED_LABEL, unplaced, "unplaced")}
      {section(DETACHED_LABEL, orphaned, "detached")}
    </>
  );
}
