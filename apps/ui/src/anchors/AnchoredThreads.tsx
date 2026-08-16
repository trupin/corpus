import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { ReattachOffer } from "../reattach/ReattachOffer";
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
 *
 * <a id="PLACEMENT_WAITS"></a>
 * **A placement waits for the row list to answer, and both of these say so.**
 * SPEC.md §11 applies the rule "when a conversation is **placed**", and
 * `ThreadPanel` latches that decision once — deliberately, so that reading a
 * conversation can never fold it. The cost of latching is that a decision taken
 * against a guess is permanent, so there must be no guesses: an anchor whose row
 * has not arrived *yet* is not a conversation this surface can place, and drawing
 * it anyway placed every resolved thread **expanded** whenever
 * `useDocs({parent, type: thread})` was a beat slower than the document read —
 * for the life of the reader, because the row that landed afterwards carried the
 * same status and so never re-armed the latch. That was reproducible under a
 * loaded machine roughly one open in eight, and deterministically with the list
 * delayed by a second.
 *
 * So a chip or a card appears when the surface knows what it is drawing, which
 * is a beat later on a slow list and not at all on a fast one — the two queries
 * are issued in the same tick and the body does not paint until the first
 * returns. Nothing is lost meanwhile: **the anchored highlight is in the body
 * from the first paint** and is not a placement, so §11's "the passage still says
 * it has been discussed" holds throughout. And the case this guard was once
 * confused with — a thread past the first page of `useDocs`, whose row is never
 * coming — is *answered*, not pending, so it keeps the panel PR #25 gave it
 * (`AnchoredThread.rowKnown`, `summaryFromAnchor`).
 */

export interface AnchorThreadsProps {
  readonly threads: readonly AnchoredThread[];
  /**
   * The document these anchors belong to — what a conversation whose row has not
   * arrived reports as its parent (`anchoredSummary`).
   */
  readonly parentId: string;
  readonly flashThread: string | null;
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
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
        // Two preconditions, and they fail for opposite reasons: no widget means
        // there is nowhere to draw this chip, and no answer about the row means
        // there is nothing to draw it *as* — see `PLACEMENT_WAITS`.
        const host = hostFor(thread.threadId);
        if (host === null || !thread.rowKnown) return null;
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
 * **Every anchor whose row has been answered for gets a panel** — see
 * `PLACEMENT_WAITS`.
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
      {threads.map((thread) =>
        !thread.rowKnown ? null : (
          <ThreadPanel
            key={thread.threadId}
            summary={anchoredSummary(thread, parentId)}
            host="margin"
            flashing={flashThread === thread.threadId}
            onOpenDoc={onOpenDoc}
            onNotify={onNotify}
          />
        ),
      )}
    </div>
  );
}

/**
 * What a detached thread needs in order to be offered a way back (UI-086).
 *
 * Absent — on a surface that has no document body to point into — the section
 * still lists its orphans, because §6's promise that they stay listed and
 * repliable does not depend on this.
 */
export interface ReattachContext {
  /** The commented document, and the body the offered ranges index into. */
  readonly docId: string;
  readonly body: string;
  /** Every anchor on the document: the orphan's own selector, and its neighbours' text. */
  readonly anchors: readonly ResolvedAnchor[];
}

export interface DetachedThreadsProps {
  readonly wholeDocument: readonly DocRow[];
  readonly orphaned: readonly DocRow[];
  /** Anchored, resolved, but with nothing on this screen to sit beside. */
  readonly unplaced?: readonly DocRow[];
  readonly reattach?: ReattachContext | undefined;
  readonly flashThread: string | null;
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
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
  reattach,
  flashThread,
  onOpenDoc,
  onNotify,
}: DetachedThreadsProps): ReactElement | null {
  if (wholeDocument.length === 0 && orphaned.length === 0 && unplaced.length === 0) return null;

  /**
   * The orphan's own anchor entry, when there is one to repair.
   *
   * Only a detached anchor carrying a quote is offered a way back: an anchor
   * that resolves is not what this is for, and a comment on the whole document
   * has no passage to search for — giving one an anchor changes the scope of
   * somebody's comment rather than repairing it, which the route refuses
   * (`not-anchored`) and which this therefore never asks for.
   */
  const repairable = (threadId: string): ResolvedAnchor | null => {
    const anchor = reattach?.anchors.find((entry) => entry.threadId === threadId);
    if (anchor === undefined || !anchor.orphaned || anchor.selector.exact === "") return null;
    return anchor;
  };

  const section = (label: string, rows: readonly DocRow[], kind: string): ReactElement | null =>
    rows.length === 0 ? null : (
      <div className="thread-slots" data-thread-section={kind}>
        <div className="slots-label">{label}</div>
        {rows.map((row) => {
          const panel = (
            <ThreadPanel
              key={row.id}
              summary={summaryFromRow(row)}
              host="slot"
              flashing={flashThread === row.id}
              onOpenDoc={onOpenDoc}
              onNotify={onNotify}
            />
          );
          const anchor = kind === "detached" ? repairable(row.id) : null;
          if (anchor === null || reattach === undefined) return panel;
          return (
            <div key={row.id} className="detached-thread">
              {panel}
              <ReattachOffer
                anchor={anchor}
                parentId={reattach.docId}
                body={reattach.body}
                anchors={reattach.anchors}
                onNotify={onNotify}
              />
            </div>
          );
        })}
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
