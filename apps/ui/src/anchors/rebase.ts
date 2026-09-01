import type { SelectionRange } from "../editor/selection";
import type { MdRange } from "./offsetMap";
import { mdRangeOfProjection, projectionRangeOfMd, sourceTraceOf } from "./sourceTrace";

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
 * **That equality is asked of the passage, not of the file** (UI-099) — and this
 * is a narrowing of what gets *asked*, not a loosening of the rule above.
 *
 * The rule was enforced as one global test: `source.plain !== target.plain` and
 * every anchor in the document was refused. But the argument it rests on is
 * *per character* — "a plain offset names the same character in both" — and a
 * character's identity is settled by the text around it, not by the far end of
 * the file. So a single construct the printer respells anywhere took every
 * highlight in the document with it, including anchors thousands of characters
 * away in text the two spellings agree about to the byte. That is the reported
 * defect: a `note` whose two spellings first part company at plain offset 23,792
 * drew nothing at all for a comment anchored at offset ~1,400, because the
 * document as a whole failed one equality.
 *
 * {@link agreeingPlainRange} asks the same question of the range in hand: is it
 * inside the two projections' common **prefix**, or inside their common
 * **suffix** (where a constant shift is the whole of the arithmetic)? Both are
 * character-for-character identity over the region the range occupies — exactly
 * the premise the global test was standing in for, and demonstrated rather than
 * assumed. A range that **straddles** a divergence is still refused, because
 * there the premise genuinely fails.
 *
 * **So this does license ranges the whole-document test refused — that is the
 * fix, not a side effect of it.** What it does not do is weaken the premise: the
 * licence is still character-for-character identity over the region the range
 * occupies, now demonstrated per range instead of assumed for the whole file.
 * And nothing that used to be licensed changes: when the two projections are
 * equal the common prefix is the whole string, every range takes the first
 * branch, and the arithmetic is the identity — exactly what the global test did.
 *
 * **The relief is bounded, and the bound is worth stating** (PR #39 review).
 * The prefix stops at the *first* divergence and the suffix reaches back only to
 * the *last*, so on a document the printer respells in **two** places every
 * range between them is still refused: the middle is in neither region. One
 * respelt construct stops being contagious; a second one re-quarantines
 * everything between the two. That is conservative and correct — across such a
 * middle the two projections genuinely disagree about which character is which
 * — but it means a long hand-written note that contains the construct more than
 * once can still draw nothing over its whole middle. `rebase.test.ts` pins it,
 * so it reads as a known limit rather than as a fresh bug.
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
 * anchor does not overlap. `rebase.test.ts` pins both — the widening with its
 * stopping point, and the ref edge, which UI-060 promised and delivered.
 *
 * **One cause of the widening is gone** (UI-060): the two-space continuation
 * indent under a list item. `mdast-util-to-hast` removes the spaces and tabs at
 * every line break and the trace now reproduces that one transformation, so a
 * paragraph that a respelling merged into the bullet above it maps character for
 * character instead of quoting itself whole. Escaping still widens, and the test
 * that names it still passes — the *commonest* cause was the indent, not the
 * escape.
 *
 * @param from the spelling `range` is addressed in
 * @param to the spelling to re-address it in
 * @returns the range in `to`, or `null` where the two cannot be shown to name
 *   the same characters over it
 */
export function rebaseRange(from: string, to: string, range: MdRange): MdRange | null {
  if (from === to) return range;
  const source = sourceTraceOf(from);
  const target = sourceTraceOf(to);
  // The `sourced` axis, never `plain`: the two spellings are two renderings of
  // one document, and the renderer's own joins are not part of what they say.
  // A blank line moved between them changes where `mdast-util-to-hast` writes a
  // `"\n"` — the exact respelling this function exists for — and comparing the
  // rendered projections would report a divergence the documents do not have.
  const projected = projectionRangeOfMd(source.runs, "sourced", range.start, range.end);
  if (projected === null) return null;
  const agreed = agreeingPlainRange(source.sourced, target.sourced, projected);
  if (agreed === null) return null;
  const rebased = mdRangeOfProjection(target.runs, "sourced", agreed.start, agreed.end);
  return rebased === null ? null : { start: rebased.start, end: rebased.end };
}

/** How many leading characters two strings share. */
function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return index;
}

/**
 * How many trailing characters two strings share, never reaching back past
 * `floor` — so the prefix and the suffix cannot claim the same characters twice
 * and `source.length - suffix` is always at or after the prefix.
 */
function commonSuffixLength(left: string, right: string, floor: number): number {
  const limit = Math.min(left.length, right.length) - floor;
  let count = 0;
  while (
    count < limit &&
    left.charCodeAt(left.length - 1 - count) === right.charCodeAt(right.length - 1 - count)
  ) {
    count += 1;
  }
  return count;
}

/**
 * The same plain range, addressed in `target` — but only where the two
 * projections demonstrably name the same characters over it.
 *
 * Two regions qualify, and they are the two where the arithmetic is exact:
 *
 * - the **common prefix**, where the offsets are unchanged;
 * - the **common suffix**, where every offset moves by the one length delta.
 *
 * Anything overlapping the divergence between them returns `null` — which, on a
 * document that diverges twice, is the whole span between the two. See the
 * module docblock for why this is the rule the global equality test was
 * approximating rather than a relaxation of it, and for what that bound costs.
 */
function agreeingPlainRange(
  source: string,
  target: string,
  range: SelectionRange,
): SelectionRange | null {
  const prefix = commonPrefixLength(source, target);
  if (range.end <= prefix) return range;
  const suffix = commonSuffixLength(source, target, prefix);
  const tail = source.length - suffix;
  if (range.start >= tail) {
    const shift = target.length - source.length;
    return { start: range.start + shift, end: range.end + shift };
  }
  return null;
}

/**
 * The same crossing in the other direction — **capture** rather than placement
 * (UI-068).
 *
 * A comment quotes the document, and SPEC.md §6's ladder matches that quote
 * against the file **literally**. But the only address a selection has is a
 * ProseMirror position, and the only map from those to markdown offsets is the
 * serializer's emission trace (`offsetMap.ts`), which indexes the *canonical
 * printing*. Nothing ever printed the file, so there is no trace into it: a
 * faithful quote is a **translation** of an offset, not a different slice of the
 * same one. That is why the trace stays — it is what makes a selection across
 * `**bold**`, across blocks and inside a `[[ref]]` exact — and why the crossing
 * happens after it rather than instead of it.
 *
 * What it costs to skip is worse here than anywhere else the two spellings meet.
 * A highlight drawn from a canonical offset against a file's numbers is a
 * misplacement the next save repairs; a **quote** in the canonical spelling that
 * the file does not contain is an anchor orphaned *at creation* — the comment is
 * detached before anyone has read it, and no later edit repairs it, because
 * every rung of the ladder is looking for bytes that were never there.
 * SERVER-071 closes the other half (`prefix`/`suffix` are recomputed from the
 * parent's own bytes on the way in) but locates the anchor by the caller's
 * `exact`, and a quote occurring *zero* times still creates its thread. So the
 * faithful `exact` has to be sent, and this is what makes it faithful.
 *
 * Two rungs, in this order:
 *
 * 1. **Rebase the range** — {@link rebaseRange} with the arguments swapped.
 *    Positional, so it names the passage the user pointed at even when the same
 *    words occur elsewhere. Its known widening (an escape that makes a run
 *    atomic in one spelling and not the other) applies here too: a quote can come
 *    back as the whole paragraph rather than the word. Wide and true beats narrow
 *    and invented.
 * 2. **The quote's single literal occurrence** — when the rebase declines, the
 *    canonical quote may still be in the file verbatim, and if it is there
 *    exactly once there is nowhere else it could have come from. This is what
 *    keeps a `[[ref]]` commentable on a file the printer respells: a reference
 *    token is in *neither* projection (`sourceTrace.ts` drops it, since it
 *    renders as a title), so a selection of nothing but a ref has no plain range
 *    to travel through. Second and not first, because uniqueness is a weaker
 *    claim than position: two spellings of one document can put the canonical
 *    quote somewhere the user was not looking.
 *
 * And when neither holds, `null` — which the comment path must **say**, not
 * paper over. A quote the file does not contain is the failure this exists to
 * prevent.
 */
export function fileRangeOf(canonical: string, file: string, range: MdRange): MdRange | null {
  const rebased = rebaseRange(canonical, file, range);
  if (rebased !== null) return rebased;
  const quote = canonical.slice(range.start, range.end);
  if (quote === "") return null;
  const at = file.indexOf(quote);
  if (at === -1 || file.indexOf(quote, at + 1) !== -1) return null;
  return { start: at, end: at + quote.length };
}
