import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { normalizeBody } from "../editor/markdown/serialize";
import type { AnchorPlacement } from "./anchorDecorations";
import { mdRangeToPm, type MdRange, type PmSegment } from "./offsetMap";
import { rebaseRange } from "./rebase";
import type { DocumentTrace } from "./traceCache";

/**
 * Server anchors → placements the decoration plugin can draw.
 *
 * The server owns resolution (SPEC.md §6's four-step ladder) and answers with a
 * character range into the body it returned. This module does one thing:
 * translate that range through the trace. It never searches for the anchor's
 * text — an anchor whose quote appears three times is the server's problem and
 * it has already answered it (sprint-011 TEST-99).
 */

/**
 * Whether the server's offsets can be trusted against a trace of `markdown`.
 *
 * The trace indexes the **canonical** spelling of the body — what the
 * serializer emits — while the server's ranges index the bytes it read from
 * disk. Those are the same string for every document the editor has ever
 * saved, and for every file already written in canonical form.
 *
 * They can also differ harmlessly: `*` bullets for `-`, `_x_` for `*x*`, `__`
 * for `**` — substitutions of equal length, which move no offset at all.
 *
 * **Total length equality is not the licence, though** (PR #10 finding 18).
 * Normalisation both shortens and lengthens: a setext heading loses characters
 * (`Title\n=====` → `# Title`), indented code gains them (`    code` →
 * ```` ```\ncode\n``` ````). One of each in the same document cancels out in
 * the total while every offset between them is shifted, and equal-length would
 * have called that comparable — which is a highlight over the wrong sentence,
 * the one failure mode worse than no highlight.
 *
 * What the licensed substitutions actually preserve is the **shape of the
 * file**: same number of lines, each the same length. Every compensating pair
 * changes that, because a construct cannot lengthen or shorten without moving
 * a line boundary or a line's length. So that is what is checked.
 *
 * **The file's tail is not part of its shape** (UI-027). The serializer ends
 * every document with exactly one newline (`normalizeBody`); the server stores
 * the body it was handed, and a `POST /api/docs` body that ends without one —
 * which is what every capture, every CLI creation from a here-string and every
 * seeded fixture produces — is stored and returned without one. That single
 * missing character made `body.length !== canonical.length` true for a document
 * that is otherwise canonical to the byte, and the trailing newline moves *no*
 * offset: every character of the body keeps its index in the canonical form,
 * and no anchor can occupy the position past the last one. Judging both sides
 * by the serializer's own tail convention is what stops "the file does not end
 * in a newline" from meaning "this document has no highlights, ever".
 *
 * When the two do not line up, this answers false and {@link segmentsOf} goes
 * the long way round instead ({@link rebaseRange}) rather than reading the
 * server's numbers against a text they do not index.
 */
export function offsetsComparable(body: string, canonical: string): boolean {
  const left = normalizeBody(body);
  const right = normalizeBody(canonical);
  if (left === right) return true;
  if (left.length !== right.length) return false;
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  if (leftLines.length !== rightLines.length) return false;
  return leftLines.every((line, index) => line.length === rightLines[index]?.length);
}

export interface AnchoredThread {
  readonly anchorId: string;
  readonly threadId: string;
  readonly row: DocRow | undefined;
  readonly orphaned: boolean;
  readonly quote: string;
  readonly placement: AnchorPlacement;
}

/**
 * **The placement rule, stated once so it stops being rediscovered** (UI-060 was
 * the thread path's version of this; UI-062 is the document's).
 *
 * A thread is drawn beside text **only where this module can point at that
 * text** — that is, only where it has at least one segment. Everything else
 * follows from it:
 *
 * - A range that begins or ends **inside inline markup** is not a special case
 *   and never was. `**` has no ProseMirror position, so the range simply starts
 *   at the first content character it covers and ends at the last: a selection
 *   dragged from inside `**Moushmi Verma**` through to a later word highlights
 *   the words and not the asterisks, in as many segments as the markup between
 *   them requires (`mdRangeToPm`, `mergeByBlock`).
 * - A range this module **cannot** express — the two spellings of the file say
 *   different things, or the range covers no content at all — yields no
 *   segments, and a thread with no segments is **not an anchored thread on this
 *   screen**. It is listed below the body with the ones that hang off no text
 *   (SPEC.md §11), never drawn in the margin, and above all never given a
 *   position it does not have. Dropping such a card at the top of the document
 *   is what made it read as a comment on the title (UI-062).
 *
 * The rule is deliberately about what can be *pointed at*, not about what the
 * server said: an anchor the server resolved is still resolved, still carries
 * its quote, and returns to its place the moment the two texts agree again.
 */
export function segmentsOf(
  anchor: ResolvedAnchor,
  body: string,
  source: DocumentTrace,
): PmSegment[] {
  return placeInto(anchor, source, readerFor(body, source));
}

/** How a range in the file's offsets is read against the trace's offsets. */
type RangeReader = (range: MdRange) => MdRange | null;

/**
 * Decided **once per document**, not once per anchor: whether the server's
 * offsets can be read straight off the trace, or have to travel through the
 * rendered text. Both answers cost a pass over the whole body, and a document
 * with twenty comments would otherwise pay for twenty of them on every render.
 */
function readerFor(body: string, source: DocumentTrace): RangeReader {
  if (offsetsComparable(body, source.markdown)) return (range) => range;
  return (range) => rebaseRange(body, source.markdown, range);
}

function placeInto(anchor: ResolvedAnchor, source: DocumentTrace, read: RangeReader): PmSegment[] {
  if (anchor.range === null || anchor.orphaned) return [];
  const range = read({ start: anchor.range.start, end: anchor.range.end });
  return range === null ? [] : mdRangeToPm(source.trace, range);
}

/** Whether this thread has a place in the body for a chip or a margin card. */
export function isPlaced(thread: AnchoredThread): boolean {
  return !thread.orphaned && thread.placement.segments.length > 0;
}

export interface PlacementInput {
  readonly anchors: readonly ResolvedAnchor[];
  readonly rows: readonly DocRow[];
  /** The body the server returned, whose offsets `anchors` use. */
  readonly body: string;
  readonly source: DocumentTrace;
}

/**
 * Every anchored thread on the document, in document order, each carrying the
 * segments its highlight occupies (empty when it is orphaned or unplaceable).
 */
export function placeAnchors({ anchors, rows, body, source }: PlacementInput): AnchoredThread[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const read = readerFor(body, source);

  const placed = anchors.map((anchor) => {
    const row = byId.get(anchor.threadId);
    const segments = placeInto(anchor, source, read);
    return {
      anchorId: anchor.anchorId,
      threadId: anchor.threadId,
      row,
      orphaned: anchor.orphaned,
      quote: anchor.selector.exact,
      placement: {
        anchorId: anchor.anchorId,
        threadId: anchor.threadId,
        resolved: anchor.threadStatus === "resolved",
        turnCount: row?.turnCount ?? 0,
        segments,
      },
    } satisfies AnchoredThread;
  });

  return placed.sort((left, right) => order(left) - order(right));
}

/** Document order: by the first position the highlight occupies. */
function order(thread: AnchoredThread): number {
  return thread.placement.segments[0]?.from ?? Number.MAX_SAFE_INTEGER;
}

/** Threads on the document that are not anchored to any text (SPEC.md §11). */
export function detachedThreads(
  rows: readonly DocRow[],
  anchors: readonly ResolvedAnchor[],
): { readonly wholeDocument: readonly DocRow[]; readonly orphaned: readonly DocRow[] } {
  const anchored = new Map(anchors.map((anchor) => [anchor.threadId, anchor]));
  const wholeDocument: DocRow[] = [];
  const orphaned: DocRow[] = [];
  for (const row of rows) {
    const anchor = anchored.get(row.id);
    if (anchor === undefined) wholeDocument.push(row);
    else if (anchor.orphaned) orphaned.push(row);
  }
  return { wholeDocument, orphaned };
}

/**
 * Threads the server anchored but this view cannot point at, in document order.
 *
 * The third way a thread ends up below the body, and the rarest: the anchor is
 * live — the server resolved it, its quote is intact, it comes back to its place
 * the moment the two texts agree — but nothing on this screen can be marked as
 * being it. See {@link segmentsOf} for why that is listed rather than drawn.
 */
export function unplacedThreads(threads: readonly AnchoredThread[]): DocRow[] {
  const rows: DocRow[] = [];
  for (const thread of threads) {
    if (isPlaced(thread) || thread.orphaned || thread.row === undefined) continue;
    rows.push(thread.row);
  }
  return rows;
}
