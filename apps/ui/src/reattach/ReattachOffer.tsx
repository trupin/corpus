import type { ResolvedAnchor } from "@corpus/contract";
import { reattachRefusalReason, useReattachThread, type RowNotice } from "@corpus/kit";
import { useMemo, useState, type ReactElement } from "react";
import {
  findReattachCandidates,
  type CandidateLimit,
  type OccupiedRange,
  type ReattachCandidate,
} from "./candidates";
import "./reattach.css";

/**
 * The affordance that makes a detached comment repairable by a person rather
 * than by curl (SPEC.md §6; SERVER-059 phase B, UI-086).
 *
 * A thread whose selector never byte-matched is detached for the life of its
 * document: reconciliation only ever carries an anchor forward or orphans it,
 * and it has no diff for a quote that never resolved. UI-068 and SERVER-071 stop
 * such anchors being born; nothing but this drains the ones that already exist.
 *
 * **Everything here is shaped by one rule: the machine may enumerate, and only
 * a person may decide.**
 *
 * - *Offered, never pre-selected.* Nothing is checked, focused as a default, or
 *   highlighted as likeliest. SERVER-055 shipped exactly that preference and was
 *   reverted for misattaching 8 of 12 shapes; a default selection is a guess
 *   wearing a person's authority, and §6 puts a visible orphan above a silent
 *   misattachment.
 * - *No score is shown*, because a number tells the person nothing they can
 *   check. What they get instead is the passage with its neighbours around it,
 *   which is the evidence a human can actually judge — the shapes this repair
 *   exists for are parallel siblings, and a person tells siblings apart by
 *   reading the lines beside them.
 * - *Leaving it detached is always available and always costless.* Detached is
 *   the state this component is called in; declining writes nothing, changes
 *   nothing, and can be done from every branch including the empty one.
 * - *The list is complete or it says otherwise.* A silently-capped list reads as
 *   "these are the only places", and the person can dismiss a bad candidate but
 *   cannot summon a missing one.
 * - *The empty case is an answer.* When nothing resembles the quote it says so,
 *   rather than lowering the floor until something appears — a weak candidate is
 *   worse than none, because it invites a click, and the click writes a selector
 *   afterwards indistinguishable from a healthy one.
 *
 * The choice travels as a **range**, never as an index into this list
 * (CONTRACT-041): the server regenerates nothing, so a list that shifted between
 * rendering and clicking cannot silently mean a different passage.
 */

export const OFFER_LABEL = "Find where it belongs…";
export const DECLINE_LABEL = "Leave it detached";
export const ATTACH_LABEL = "Attach here";
export const PICKER_TITLE = "Where does this comment belong?";

export const PICKER_LEAD =
  "Corpus cannot tell: deleting a line, and renaming it while deleting its neighbour, leave the " +
  "same document behind. Nothing below is selected — pick the passage you commented on, or leave " +
  "it detached.";

export const DECLINE_META = "nothing is written · the quote and the conversation are kept";

export const OFFER_NOTE =
  "Its quoted text is not in this document, so it has no place to sit. It is fully repliable " +
  "where it is.";

export const EMPTY_MESSAGE =
  "Nothing in this document resembles the quoted text. Leaving it detached keeps the quote and " +
  "the conversation exactly as they are.";

export const TAKEN_MESSAGE = "Another conversation is already anchored to this text.";

/** Says what is missing from the list, in the person's terms rather than the algorithm's. */
export function limitMessage(limit: CandidateLimit): string {
  switch (limit.kind) {
    case "count":
      return (
        `${String(limit.found)} passages resemble the quoted text; the first ${String(limit.shown)} ` +
        "are listed here in document order. The rest are not shown."
      );
    case "quote-too-long":
      return (
        `The quoted text is ${String(limit.length)} characters long, past the ${String(limit.max)} ` +
        "this search covers, so no candidates were looked for."
      );
    case "document-too-large":
      return "This document is too large to search for candidate passages.";
  }
}

/** What a refusal asks the person to do next; the reason is machine-readable for this. */
export function refusalMessage(error: unknown): string {
  switch (reattachRefusalReason(error)) {
    case "range-changed":
      return "The document changed while you were choosing. It has been re-read — pick again.";
    case "range-overlaps":
      return "Another conversation is already anchored to that text. Pick a different passage.";
    case "not-anchored":
      return "This comment has no anchor to repair.";
    default:
      return `Re-attach failed — ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Other threads' live anchors on this document — the text §6 forbids overlapping. */
export function occupiedRanges(
  anchors: readonly ResolvedAnchor[],
  exceptAnchorId: string,
): OccupiedRange[] {
  const ranges: OccupiedRange[] = [];
  for (const anchor of anchors) {
    if (anchor.anchorId === exceptAnchorId || anchor.range === null) continue;
    ranges.push({ threadId: anchor.threadId, range: anchor.range });
  }
  return ranges;
}

export interface ReattachOfferProps {
  /** The orphaned thread's own anchor entry, carrying its preserved selector. */
  readonly anchor: ResolvedAnchor;
  /** The parent document, and the body the offered ranges are offsets into. */
  readonly parentId: string;
  readonly body: string;
  /** Every anchor on the parent, this one included; the rest become occupied text. */
  readonly anchors: readonly ResolvedAnchor[];
  readonly onNotify: (notice: RowNotice) => void;
}

export function ReattachOffer({
  anchor,
  parentId,
  body,
  anchors,
  onNotify,
}: ReattachOfferProps): ReactElement {
  const [open, setOpen] = useState(false);

  const reattach = useReattachThread({
    onSuccess: () => {
      setOpen(false);
      onNotify({ tone: "info", message: "Comment re-attached · committed" });
    },
    onError: (error) => {
      onNotify({ tone: "error", message: refusalMessage(error) });
    },
  });

  /*
   * Searched on demand, and only while the picker is open: the scan is a whole
   * pass over the document, and a reader carrying several orphans would
   * otherwise pay for all of them on every render of a list nobody asked to see.
   */
  const search = useMemo(
    () =>
      open
        ? findReattachCandidates({
            body,
            quote: anchor.selector.exact,
            occupied: occupiedRanges(anchors, anchor.anchorId),
          })
        : null,
    [anchor.anchorId, anchor.selector.exact, anchors, body, open],
  );

  const decline = (
    <button
      type="button"
      className="reattach-decline"
      data-reattach-decline
      onClick={() => {
        setOpen(false);
      }}
    >
      {DECLINE_LABEL}
      <span className="reattach-meta">{DECLINE_META}</span>
    </button>
  );

  if (search === null) {
    return (
      <div className="reattach" data-reattach={anchor.threadId}>
        <p className="reattach-note">{OFFER_NOTE}</p>
        <button
          type="button"
          className="reattach-open"
          data-reattach-open
          onClick={() => {
            setOpen(true);
          }}
        >
          {OFFER_LABEL}
        </button>
      </div>
    );
  }

  return (
    <div
      className="reattach open"
      data-reattach={anchor.threadId}
      role="group"
      aria-label={PICKER_TITLE}
    >
      <p className="reattach-title">{PICKER_TITLE}</p>
      <p className="reattach-lead">{PICKER_LEAD}</p>
      {search.limit === null ? null : (
        <p className="reattach-limit" data-reattach-limit>
          {limitMessage(search.limit)}
        </p>
      )}
      {search.candidates.length === 0 ? (
        <p className="reattach-empty" data-reattach-empty>
          {EMPTY_MESSAGE}
        </p>
      ) : (
        <ul className="reattach-candidates">
          {search.candidates.map((candidate) => (
            <li
              key={`${String(candidate.range.start)}:${String(candidate.range.end)}`}
              className="reattach-candidate"
              data-reattach-candidate={candidate.range.start}
            >
              <CandidateContext candidate={candidate} />
              {candidate.takenBy === null ? (
                <button
                  type="button"
                  className="reattach-attach"
                  data-reattach-attach={candidate.range.start}
                  disabled={reattach.isPending}
                  onClick={() => {
                    reattach.mutate({
                      id: anchor.threadId,
                      parentId,
                      range: candidate.range,
                      expectedText: candidate.text,
                    });
                  }}
                >
                  {reattach.isPending ? "Attaching…" : ATTACH_LABEL}
                </button>
              ) : (
                <p className="reattach-taken" data-reattach-taken={candidate.takenBy}>
                  {TAKEN_MESSAGE}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {decline}
    </div>
  );
}

/**
 * The passage, with its neighbours around it — the whole of what the person is
 * agreeing to.
 *
 * Whitespace is preserved rather than collapsed: the sibling shapes this repair
 * exists for (list items, table rows, task lines, numbered steps) are told apart
 * by their line structure, and a run of lines flattened into a paragraph hides
 * exactly the difference being judged.
 */
function CandidateContext({ candidate }: { readonly candidate: ReattachCandidate }): ReactElement {
  return (
    <div className="reattach-context">
      {candidate.precededByMore ? <span className="reattach-ellipsis">…</span> : null}
      <span className="reattach-around">{candidate.before}</span>
      <mark className="reattach-passage">{candidate.text}</mark>
      <span className="reattach-around">{candidate.after}</span>
      {candidate.followedByMore ? <span className="reattach-ellipsis">…</span> : null}
    </div>
  );
}
