import DiffMatchPatch from "diff-match-patch";
import type { Range } from "./types.js";

/**
 * Explicit diff deadline (seconds). A timed-out diff degrades to a coarser —
 * but still valid — edit script: anchors may classify as partial/deleted more
 * eagerly (and thus remap or orphan), they are never mapped incorrectly.
 */
export const DIFF_TIMEOUT_SECONDS = 1;

export type RangeClass = "equal" | "partial" | "deleted";

export type OffsetMapper = {
  /** Map a range start old → new. An insertion exactly at the offset stays outside (maps after it). */
  mapStart(oldOffset: number): number;
  /** Map a range end old → new. An insertion exactly at the offset stays outside (maps before it). */
  mapEnd(oldOffset: number): number;
  /** How the edit touched `[start, end)`: untouched, partially edited, or no surviving character. */
  classify(range: Range): RangeClass;
  /**
   * Whether `[start, end)` of `newBody` contains at least one character this
   * edit inserted. Distinguishes text the edit *brought in* (cut-and-paste, a
   * rewrite that kept a sentence verbatim) from text that already sat there
   * before the edit — a pre-existing doppelgänger of something deleted.
   */
  touchesInsertion(range: Range): boolean;
};

type Segment = {
  op: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
};

const { DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } = DiffMatchPatch;

/**
 * Diff `oldBody` → `newBody` (diff-match-patch + semantic cleanup, so "was
 * this range touched?" is judged against human-meaningful edits, not
 * character-level noise) and expose the old→new offset mapping over it.
 */
export function computeOffsetMapper(oldBody: string, newBody: string): OffsetMapper {
  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = DIFF_TIMEOUT_SECONDS;
  const diffs = dmp.diff_main(oldBody, newBody);
  dmp.diff_cleanupSemantic(diffs);

  const segments: Segment[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const [op, text] of diffs) {
    const segment: Segment = {
      op,
      oldStart: oldPos,
      oldEnd: oldPos,
      newStart: newPos,
      newEnd: newPos,
    };
    if (op !== DIFF_INSERT) {
      oldPos += text.length;
      segment.oldEnd = oldPos;
    }
    if (op !== DIFF_DELETE) {
      newPos += text.length;
      segment.newEnd = newPos;
    }
    segments.push(segment);
  }
  const newLength = newPos;

  const mapStart = (oldOffset: number): number => {
    for (const segment of segments) {
      if (segment.oldStart <= oldOffset && oldOffset < segment.oldEnd) {
        // Zero-width (INSERT) segments never satisfy the strict upper bound,
        // so an insertion sitting exactly at the offset is skipped: text
        // inserted just before a range pushes the range right, it does not
        // become part of it.
        return segment.op === DIFF_EQUAL
          ? segment.newStart + (oldOffset - segment.oldStart)
          : segment.newStart; // DELETE: the head of the range was deleted; collapse to the replacement's start.
      }
    }
    return newLength;
  };

  const mapEnd = (oldOffset: number): number => {
    if (oldOffset <= 0) return 0;
    for (const [index, segment] of segments.entries()) {
      if (segment.oldStart < oldOffset && oldOffset <= segment.oldEnd) {
        if (segment.op === DIFF_EQUAL) {
          return segment.newStart + (oldOffset - segment.oldStart);
        }
        // DELETE overlapping the range tail. When an INSERT immediately
        // follows, the pair is a replacement of in-range text — include the
        // replacement so a partially edited range keeps its new wording.
        const next = segments[index + 1];
        return next !== undefined && next.op === DIFF_INSERT ? next.newEnd : segment.newStart;
      }
    }
    return newLength;
  };

  const classify = (range: Range): RangeClass => {
    const { start, end } = range;
    if (start >= end) return "deleted";
    let surviving = 0;
    let touched = false;
    for (const segment of segments) {
      if (segment.op === DIFF_EQUAL) {
        const overlap = Math.min(end, segment.oldEnd) - Math.max(start, segment.oldStart);
        if (overlap > 0) surviving += overlap;
      } else if (segment.op === DIFF_DELETE) {
        if (segment.oldStart < end && segment.oldEnd > start) touched = true;
      } else if (start < segment.oldStart && segment.oldStart < end) {
        // An insertion strictly inside the range edits it even though every
        // old character survives — the new slice differs from the old exact.
        touched = true;
      }
    }
    if (surviving === 0) return "deleted";
    return touched ? "partial" : "equal";
  };

  const touchesInsertion = ({ start, end }: Range): boolean => {
    if (start >= end) return false;
    return segments.some(
      (segment) => segment.op === DIFF_INSERT && segment.newStart < end && segment.newEnd > start,
    );
  };

  return { mapStart, mapEnd, classify, touchesInsertion };
}
