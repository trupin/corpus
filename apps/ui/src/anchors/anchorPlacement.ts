import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { AnchorPlacement } from "./anchorDecorations";
import { mdRangeToPm } from "./offsetMap";
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
 * They can also differ harmlessly: `*` bullets for `-`, `_x_` for `*x*`, `**`
 * for `__` — substitutions of equal length, which move no offset at all. Length
 * equality is therefore a sound licence, not a guess.
 *
 * When the two differ in length (a setext heading, indented code, CRLF), the
 * offsets genuinely do not line up, and this answers false: the threads stay
 * listed and fully usable, they simply carry no highlight until the first save
 * writes the body back in canonical form. A highlight over the wrong sentence
 * would be worse than no highlight.
 */
export function offsetsComparable(body: string, canonical: string): boolean {
  return body === canonical || body.length === canonical.length;
}

export interface AnchoredThread {
  readonly anchorId: string;
  readonly threadId: string;
  readonly row: DocRow | undefined;
  readonly orphaned: boolean;
  readonly quote: string;
  readonly placement: AnchorPlacement;
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
  const usable = offsetsComparable(body, source.markdown);

  const placed = anchors.map((anchor) => {
    const row = byId.get(anchor.threadId);
    const segments =
      anchor.range === null || anchor.orphaned || !usable
        ? []
        : mdRangeToPm(source.trace, { start: anchor.range.start, end: anchor.range.end });
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
