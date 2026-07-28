import type { TraceRun } from "../editor/markdown/serialize";

/**
 * Markdown character offsets ↔ ProseMirror positions — the crux of UI-007.
 *
 * The server anchors a thread to a **text-quote selector** and resolves it
 * against the markdown body (SPEC.md §6), so `GET /api/docs/{id}` answers with
 * character offsets into a string. The editor holds a ProseMirror document,
 * whose positions count nodes and text, not syntax. A highlight has to be drawn
 * in the second coordinate system from a range given in the first, and a new
 * comment has to be described in the first from a selection made in the second.
 *
 * Neither direction is a search. The mapping is read off the **emission trace**
 * the one serializer produces alongside the markdown (`serialize.ts`,
 * sprint-011 TEST-87): every run of content with both of its addresses, in
 * order. Everything here is a binary search into that trace plus arithmetic
 * inside a run.
 *
 * Two rules the trace makes possible and this module states:
 *
 * - **Syntax has no address.** `## `, `- `, `**`, a fence line, a blockquote's
 *   `> ` — the printer wrote them, no ProseMirror text produced them, and they
 *   are in no run. An offset landing in one is not addressable, so it **snaps
 *   to the nearest content boundary in the direction that keeps the range
 *   inside content**: a start moves forward to the first content character at
 *   or after it, an end moves back to the last content character at or before
 *   it. A range that is nothing but syntax maps to nothing at all, which is the
 *   honest answer.
 * - **A block is the horizon.** ProseMirror inline decorations cannot cross a
 *   textblock, so a range spanning blocks answers with one segment per block
 *   rather than one impossible decoration (sprint-011 TEST-94).
 */

export interface MdRange {
  readonly start: number;
  readonly end: number;
}

export interface PmRange {
  readonly from: number;
  readonly to: number;
}

/** A decoration's worth of range: within one textblock, by construction. */
export interface PmSegment extends PmRange {
  readonly block: number;
}

/** Index of the first run that could touch `start`, i.e. the first with `mdEnd > start`. */
function firstRunFromMd(trace: readonly TraceRun[], start: number): number {
  let low = 0;
  let high = trace.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((trace[middle]?.mdEnd ?? 0) > start) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The same, in ProseMirror space: the first run with `pmTo > from`. */
function firstRunFromPm(trace: readonly TraceRun[], from: number): number {
  let low = 0;
  let high = trace.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((trace[middle]?.pmTo ?? 0) > from) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Consecutive pieces of one textblock become one decoration.
 *
 * The gaps between them are the syntax the range covered — `**`, an inline
 * code fence, a `[` — and a highlight that stopped at each of them would draw a
 * dashed line through a sentence the reader selected as one thing.
 */
function mergeByBlock(segments: readonly PmSegment[]): PmSegment[] {
  const merged: PmSegment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (last !== undefined && last.block === segment.block) {
      merged[merged.length - 1] = {
        from: Math.min(last.from, segment.from),
        to: Math.max(last.to, segment.to),
        block: last.block,
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

/**
 * Where a markdown range lands in the editor — one segment per textblock it
 * touches, in document order, empty when it touches no content at all.
 */
export function mdRangeToPm(trace: readonly TraceRun[], range: MdRange): PmSegment[] {
  if (range.end <= range.start) return [];
  const segments: PmSegment[] = [];
  for (let index = firstRunFromMd(trace, range.start); index < trace.length; index += 1) {
    const run = trace[index];
    if (run === undefined || run.mdStart >= range.end) break;
    const start = Math.max(range.start, run.mdStart);
    const end = Math.min(range.end, run.mdEnd);
    if (end <= start) continue;
    segments.push(
      run.atomic
        ? { from: run.pmFrom, to: run.pmTo, block: run.block }
        : {
            from: run.pmFrom + (start - run.mdStart),
            to: run.pmFrom + (end - run.mdStart),
            block: run.block,
          },
    );
  }
  return mergeByBlock(segments);
}

/**
 * What a selection quotes, as one contiguous slice of the file.
 *
 * Contiguous on purpose: a selection running from one paragraph into the next
 * quotes the newlines between them, and a selection crossing `**bold**` quotes
 * the asterisks. That is what the file says, it is what the server's resolution
 * ladder matches against, and anything tidier would be a quote of a document
 * that does not exist.
 *
 * `null` when the selection touches no content — a caret, or a position inside
 * syntax with nothing addressable in it.
 */
export function pmRangeToMd(trace: readonly TraceRun[], range: PmRange): MdRange | null {
  if (range.to <= range.from) return null;
  let start: number | null = null;
  let end = 0;
  for (let index = firstRunFromPm(trace, range.from); index < trace.length; index += 1) {
    const run = trace[index];
    if (run === undefined || run.pmFrom >= range.to) break;
    const from = Math.max(range.from, run.pmFrom);
    const to = Math.min(range.to, run.pmTo);
    if (to <= from) continue;
    if (start === null) {
      start = run.atomic ? run.mdStart : run.mdStart + (from - run.pmFrom);
    }
    end = run.atomic ? run.mdEnd : run.mdStart + (to - run.pmFrom);
  }
  return start === null ? null : { start, end };
}
