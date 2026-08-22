import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useId, useMemo, type ReactElement } from "react";
import { ReattachOffer } from "../reattach/ReattachOffer";
import { summaryFromRow } from "../thread/CollapsedThread";
import { ThreadPanel } from "../thread/ThreadPanel";
import {
  anchorReason,
  commentRowLabel,
  commentRows,
  countComments,
  emptyCommentsNotice,
  filterComments,
  type AnchorFilter,
  type CommentCounts,
  type CommentFilters,
  type StatusFilter,
} from "./commentsModel";
import { NewCommentComposer } from "./NewCommentComposer";
import "./comments.css";

/**
 * The Comments tab — the document's conversations as a surface you can work
 * (SPEC.md §10, rider signed 2026-08-04).
 *
 * It holds **every** thread on the document, anchored or not, filters on two
 * independent axes, reveals an anchored row at its anchor, says why an
 * unanchored one has none, and carries the composer that starts a new thread
 * with no selection. UI-063 is finding a comment and UI-067 is writing one; they
 * are one surface, and this is it.
 *
 * **It subsumed the 💬 popover.** That popover listed the same rows from the same
 * query, one line each, with nothing to do about any of them. Two lists over one
 * set of rows is the duplication the issue warned about, so the head's 💬 button
 * became this tab's half of the `Document / Comments` switch and the popover's
 * two helpers — `threadMeta` and `threadQuote` — moved into `commentsModel.ts`
 * rather than being rewritten. That is what keeps a row's turn count and status
 * from disagreeing with the board column showing the same thread.
 *
 * **A row is a `ThreadPanel`**, which is the same component every other
 * placement uses. So a conversation listed here obeys the one collapse rule, is
 * marked seen when it is displayed and not before, carries its own reply box,
 * its resolve/reopen control and its right-click menu — §10's *"every thread in
 * the list can be replied to in place"* is not a second reply path, it is the
 * reply path, in a third placement.
 *
 * **The below-the-body listing stays**, and that is the rider's own instruction:
 * *"Whole-document comments and orphaned threads remain listed below the body."*
 * The two surfaces answer different questions — the body's list says "this
 * conversation has nowhere to sit in the text", this one says "here is
 * everything outstanding on this document" — and both render the same
 * `ThreadPanel` over the same rows, so neither can say anything the other does
 * not.
 */

export interface CommentsTabProps {
  readonly docId: string;
  /** Every thread on this document — `GET /api/docs?parent=…&type=thread`. */
  readonly threads: readonly DocRow[];
  /**
   * The document's resolved anchors, which is what decides the anchored axis:
   * `orphaned` is the server's verdict about the body as it now stands, and a
   * stored selector's *text* is not (see {@link AnchorState}).
   */
  readonly anchors: readonly ResolvedAnchor[];
  /** The body a re-attach offer searches. Empty where there is none to point into. */
  readonly body: string;
  readonly filters: CommentFilters;
  readonly onFilters: (filters: CommentFilters) => void;
  readonly flashThread: string | null;
  /**
   * Reveal this conversation at its anchor — §10's *"selecting an anchored row
   * reveals it at its anchor in the document"*.
   *
   * The host owns it because revealing means leaving this tab: the body is not
   * mounted while the list is, so the switch has to flip before the reveal seam
   * (UI-037's `jumpToThread`) has anything to reveal into.
   */
  readonly onReveal: (threadId: string) => void;
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function CommentsTab({
  docId,
  threads,
  anchors,
  body,
  filters,
  onFilters,
  flashThread,
  onReveal,
  onOpenDoc,
  onNotify,
}: CommentsTabProps): ReactElement {
  const rows = useMemo(() => commentRows(threads, anchors), [threads, anchors]);
  const counts = useMemo(() => countComments(rows), [rows]);
  const visible = useMemo(() => filterComments(rows, filters), [rows, filters]);

  return (
    <section className="comments-tab" aria-label="Comments on this document">
      <div className="cm-filters">
        <FilterGroup
          label="Status"
          value={filters.status}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "open", label: "Open", count: counts.open },
            { value: "resolved", label: "Resolved", count: counts.resolved },
          ]}
          onChoose={(status) => {
            onFilters({ ...filters, status });
          }}
        />
        <FilterGroup
          label="Anchor"
          value={filters.anchor}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "anchored", label: "Anchored", count: counts.anchored },
            { value: "unanchored", label: "Unanchored", count: counts.unanchored },
          ]}
          onChoose={(anchor) => {
            onFilters({ ...filters, anchor });
          }}
        />
      </div>

      {visible.length === 0 ? (
        <p className="cm-empty" role="status">
          {emptyCommentsNotice(counts, filters)}
        </p>
      ) : (
        <div className="cm-rows">
          {visible.map((entry) => (
            <section
              key={entry.row.id}
              className="cm-row"
              data-comment-row={entry.row.id}
              data-anchor-state={entry.anchorState}
              aria-label={commentRowLabel(entry.row)}
            >
              <div className="cm-why">
                {/* The sentence is the row's own answer to "why is this not in
                    the document?", and it is variable text in a fixed box: it
                    truncates and the whole of it is on the `title`
                    (SHARED-057 clause 2). */}
                <span className="cm-why-text" title={anchorReason(entry)}>
                  {anchorReason(entry)}
                </span>
                {entry.anchorState === "anchored" ? (
                  <button
                    type="button"
                    className="cm-reveal"
                    data-reveal-thread={entry.row.id}
                    title="Show this conversation at its anchor in the document"
                    onClick={() => {
                      onReveal(entry.row.id);
                    }}
                  >
                    Show in document
                  </button>
                ) : null}
              </div>

              <ThreadPanel
                summary={summaryFromRow(entry.row)}
                host="slot"
                flashing={flashThread === entry.row.id}
                onOpenDoc={onOpenDoc}
                onNotify={onNotify}
              />

              {/*
               * A way back, for the one state that has somewhere to go (UI-086).
               * Offered only for a detached anchor that kept a quote to search
               * for: an anchor that resolves is not what this is for, and a
               * comment on the whole document has no passage to look for — giving
               * one an anchor changes the scope of somebody's remark rather than
               * repairing it, which the route refuses.
               */}
              {entry.anchorState === "orphaned" &&
              entry.anchor !== null &&
              entry.anchor.selector.exact !== "" &&
              body !== "" ? (
                <ReattachOffer
                  anchor={entry.anchor}
                  parentId={docId}
                  body={body}
                  anchors={anchors}
                  onNotify={onNotify}
                />
              ) : null}
            </section>
          ))}
        </div>
      )}

      <NewCommentComposer docId={docId} onNotify={onNotify} />
    </section>
  );
}

interface FilterOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count: number;
}

interface FilterGroupProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly FilterOption<T>[];
  readonly onChoose: (value: T) => void;
}

/**
 * One filter axis, as a **native radio group** drawn as a segmented control.
 *
 * Native, not `role="radio"` on buttons, and the difference is the whole of the
 * keyboard story: a real radio group is one Tab stop whose positions the arrow
 * keys move between, and a browser gives that for free. Buttons with an ARIA
 * role would have to re-implement the roving tabindex, and every one of them
 * would be its own Tab stop until it did.
 *
 * The input stays focusable — it is made invisible rather than `display: none`,
 * which would take it out of the tab order — and the label around it is the box
 * that is drawn.
 *
 * **Nothing here resizes with its count** (SHARED-057). The count sits in its own
 * reserved box, so a filter going from `9` to `12` moves nothing, and the labels
 * are fixed strings — the widths are decided by the words, never by the corpus.
 */
function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChoose,
}: FilterGroupProps<T>): ReactElement {
  // Unique per mounted group: two readers open side by side each own their
  // filters, and a shared `name` would make one column's click move the other's.
  const group = useId();
  return (
    <div className="cm-filter" role="group" aria-label={`${label} filter`}>
      <span className="cm-filter-label">{label}</span>
      {options.map((option) => (
        <label
          key={option.value}
          className={value === option.value ? "cm-opt on" : "cm-opt"}
          data-filter={`${label.toLowerCase()}:${option.value}`}
        >
          <input
            type="radio"
            className="cm-opt-input"
            name={group}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChoose(option.value);
            }}
          />
          {option.label} <span className="cm-count">{option.count}</span>
        </label>
      ))}
    </div>
  );
}

export type { AnchorFilter, CommentCounts, CommentFilters, StatusFilter };
