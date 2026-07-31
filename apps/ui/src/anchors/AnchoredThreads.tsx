import type { DocRow } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { ThreadSlot } from "../reader/ThreadSlot";
import { ThreadCard } from "../thread/ThreadCard";
import type { AnchoredThread } from "./anchorPlacement";
import "./anchors.css";

/**
 * The three places an anchored thread can be, and the one place a detached one
 * is (SPEC.md §11).
 *
 * - **A chip at its anchor**, in a narrow column — a widget between the two
 *   blocks the anchor sits between, with the real `ThreadSlot` portalled into
 *   it. The slot itself is UI-008's; this decides *where*.
 * - **A card in the margin**, in focus mode or a wide reader, cascaded beside
 *   its highlight.
 * - **Below the body**, for whole-document threads and for threads whose anchor
 *   the server could no longer resolve.
 */

export interface AnchorThreadsProps {
  readonly threads: readonly AnchoredThread[];
  readonly expandedThreads: readonly string[];
  readonly flashThread: string | null;
  readonly onToggleThread: (threadId: string) => void;
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
  expandedThreads,
  flashThread,
  onToggleThread,
  onOpenDoc,
  onNotify,
  hostFor,
}: AnchorChipsProps): ReactElement {
  return (
    <>
      {threads.map((thread) => {
        const host = thread.row === undefined ? null : hostFor(thread.threadId);
        if (host === null || thread.row === undefined) return null;
        return createPortal(
          <ThreadSlot
            row={thread.row}
            expanded={expandedThreads.includes(thread.threadId)}
            flashing={flashThread === thread.threadId}
            onToggle={() => {
              onToggleThread(thread.threadId);
            }}
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
 * The margin column. Cards are absolutely positioned by `useMarginLayout`, so
 * their order in the DOM is irrelevant and their `top` is everything.
 *
 * No `onCollapse`: a margin card has no chip to fold back into, and
 * `ThreadCard` renders the `–` control exactly when the host gives it one.
 */
export function MarginColumn({
  threads,
  flashThread,
  onOpenDoc,
  onNotify,
  innerRef,
}: MarginColumnProps): ReactElement {
  return (
    <div className="focus-margin" ref={innerRef} data-anchor-margin>
      {threads.map((thread) => (
        <ThreadCard
          key={thread.threadId}
          threadId={thread.threadId}
          host="margin"
          row={thread.row}
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
  readonly expandedThreads: readonly string[];
  readonly flashThread: string | null;
  readonly onToggleThread: (threadId: string) => void;
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export const DETACHED_LABEL = "Detached threads";
export const WHOLE_DOCUMENT_LABEL = "Whole-document threads";

/**
 * Threads that hang off no text: the ones that never did, and the ones whose
 * quote the last save removed.
 *
 * An orphaned thread is **not** damaged — SPEC.md §6 keeps its selector
 * byte-for-byte, so it still knows what it was about and is still fully
 * repliable. It has simply lost its place in the document, which is why it is
 * listed rather than hidden.
 */
export function DetachedThreads({
  wholeDocument,
  orphaned,
  expandedThreads,
  flashThread,
  onToggleThread,
  onOpenDoc,
  onNotify,
}: DetachedThreadsProps): ReactElement | null {
  if (wholeDocument.length === 0 && orphaned.length === 0) return null;

  const section = (label: string, rows: readonly DocRow[], kind: string): ReactElement | null =>
    rows.length === 0 ? null : (
      <div className="thread-slots" data-thread-section={kind}>
        <div className="slots-label">{label}</div>
        {rows.map((row) => (
          <ThreadSlot
            key={row.id}
            row={row}
            expanded={expandedThreads.includes(row.id)}
            flashing={flashThread === row.id}
            onToggle={() => {
              onToggleThread(row.id);
            }}
            onOpenDoc={onOpenDoc}
            onNotify={onNotify}
          />
        ))}
      </div>
    );

  return (
    <>
      {section(WHOLE_DOCUMENT_LABEL, wholeDocument, "whole-document")}
      {section(DETACHED_LABEL, orphaned, "detached")}
    </>
  );
}
