import type { MdRange } from "./offsetMap";
import { mdRangeOfPlain, plainRangeOfMd, sourceTraceOf } from "./sourceTrace";

/**
 * One range, re-expressed in a second spelling of the same document.
 *
 * The server's anchor ranges index the **file on disk**. The editor's offset map
 * indexes the **canonical serialization** — what `serialize.ts` would print for
 * the document the editor parsed out of that file. Those are the same string for
 * a file the editor has saved, and `offsetsComparable` licenses the cheap cases
 * where they differ without moving an offset (`__x__` for `**x**`).
 *
 * They differ for real more often than that suggests, and always in the same
 * way — the *markup* is respelled while the *prose* is untouched:
 *
 * - a blank line between the frontmatter fence and the first block, which the
 *   parser keeps in the body and the printer does not re-emit (UI-062: the
 *   ordinary shape of a hand- or agent-written file);
 * - a GFM table, which the printer pads to align its columns;
 * - a hard break written as two trailing spaces, which the printer writes `\`;
 * - a setext heading (`Title\n=====` → `# Title`);
 * - an indented code block (four spaces → a fence).
 *
 * Every one of those shifts every offset after it, so the server's numbers
 * cannot be read against the canonical text — and the consequence used to be
 * that such a document drew **no highlights at all**, and its thread cards piled
 * up at the top of the margin as though every comment were about the title.
 *
 * The way across is the projection both spellings share: the text a reader sees.
 * `sourceTrace.ts` already computes it for the thread path, straight from
 * remark's node positions, so it is available for any markdown string without a
 * parse of our own. A range travels file → plain → canonical.
 *
 * **The licence is plain-text equality, and nothing weaker.** If the two
 * spellings render the same characters in the same order, then a plain offset
 * names the same character in both, and the round trip is arithmetic rather than
 * a search — no occurrence to disambiguate, no similarity to threshold. If they
 * do not, the two documents genuinely say different things and this refuses,
 * exactly as `turnAnchors.ts` refuses when its two projections disagree about a
 * quote's occurrences (PR #20): a visible gap beats a confident lie about which
 * sentence a comment is on.
 *
 * **The result is not always the true range — it can be wider, and at a
 * `[[ref]]` edge it can be narrower.** Plain-text equality licenses the
 * *offsets*; it says nothing about granularity.
 * `sourceTrace.ts` marks a run **atomic** when its markdown and its text differ
 * character for character, and a partial hit inside an atomic run quotes the
 * whole run rather than slicing a string whose offsets do not line up. Escaping
 * routinely makes a run atomic in one spelling and not the other: a file that
 * writes `5 \* 3` — what a defensively-escaping printer produces — has one atomic
 * run spanning the paragraph, while the canonical text prints a bare `5 * 3`
 * (`escape.ts` leaves an asterisk with spaces on both sides alone, since it can
 * neither open nor close emphasis) and maps character for character. A range
 * travelling through such a run therefore comes back **widened to the run**: a
 * comment on one word highlights the paragraph.
 *
 * The widening is bounded: it grows only to the runs the range already
 * overlapped and never past them, so it stops at the paragraph and cannot reach
 * the next one.
 *
 * **The narrowing case, which an earlier version of this comment denied.**
 * `pushText` splits a text node around its `refSpans` and emits *no run* for the
 * reference token itself, because a `[[ref]]` renders as a title rather than as
 * its own characters. A range whose leading or trailing edge sits on a ref
 * therefore comes back without it: an anchor over `[[doc_a1]] carefully` rebases
 * to ` carefully`, and the highlight starts after the reference. Small on
 * screen, and worth stating exactly, because this comment is what the next
 * reader will reason from — it previously claimed the result "always contains
 * the true one", which is false at a ref edge (PR #21 re-review, MINOR 1).
 *
 * Neither direction is a *misplacement*: the range never lands on words the
 * anchor does not overlap. `rebase.test.ts` pins the widening and its stopping
 * point; the ref edge is not yet pinned and belongs with UI-060's parity work.
 */
export function rebaseRange(from: string, to: string, range: MdRange): MdRange | null {
  if (from === to) return range;
  const source = sourceTraceOf(from);
  const target = sourceTraceOf(to);
  if (source.plain !== target.plain) return null;
  const plain = plainRangeOfMd(source.runs, range.start, range.end);
  if (plain === null) return null;
  const rebased = mdRangeOfPlain(target.runs, plain.start, plain.end);
  return rebased === null ? null : { start: rebased.start, end: rebased.end };
}
