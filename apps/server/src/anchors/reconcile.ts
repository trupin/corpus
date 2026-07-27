import { snapRange } from "./code-points.js";
import { computeContext } from "./context.js";
import { computeOffsetMapper } from "./diff.js";
import { FUZZY_THRESHOLD, boundedLevenshtein } from "./fuzzy.js";
import { resolveAnchor, resolveAnchorExact, sortedEntries } from "./resolve.js";
import type {
  AnchorsMap,
  Range,
  ReconcileReport,
  ReconcileResult,
  TextQuoteSelector,
} from "./types.js";

/**
 * Map every anchor of a document through the `oldBody` → `newBody` edit
 * (SPEC.md §6, "Anchor reconciliation"). Pure: no filesystem, git, database,
 * or HTTP — the caller (the server's save path) owns persisting the result.
 *
 * Per anchor, in sorted-id order (output and report are deterministic —
 * reconciliation output is committed to git):
 *
 * - does not resolve in `oldBody` → it was already orphaned before this edit:
 *   selector kept as-is, reported `orphaned`, never re-attached by fuzzy
 *   matching the new body;
 * - range untouched → `exact` kept, context recomputed from the new
 *   surroundings (`unchanged` when the context is identical, else `remapped`);
 * - range partially edited → the new text spanned by the mapped range becomes
 *   `exact`, context recomputed, reported `remapped` — *provided the mapped
 *   slice is trustworthy*. The diff is advisory and its slice is a claim whose
 *   honesty is checked before it is trusted (SERVER-012):
 *   - a DELETE+INSERT replacement straddling a range boundary grants the range
 *     replacement text that also replaces content outside it (truncated
 *     selectors, a neighbour's words);
 *   - a slice whose emitted selector would resolve anywhere but the slice's
 *     own range (self-round-trip) would misattach its thread on the very next
 *     lookup;
 *   - a rewritten slice with no kinship to its original is not in-place-edit
 *     evidence: when the slice's similarity to the original exact falls below
 *     the fuzzy threshold *and* the original survives verbatim at another
 *     location, the mapper merely kept a byte offset across a relocation and
 *     handed the anchor whatever text occupies it now (the substitution
 *     family: swaps, rotations, moves with insertions);
 *   - two anchors whose old ranges were disjoint but whose new ranges overlap
 *     prove at least one slice swallowed text that belongs to the other — the
 *     offset mapping is monotone, so an honest in-place rewrite can never make
 *     disjoint ranges collide (the whole-document-reorder family, where the
 *     diff stuffs an entire relocated paragraph into a small replacement
 *     wholly *inside* the range, defeating the straddle check).
 *   A dishonest slice is rejected and the anchor takes the same verification
 *   path as a deletion claim;
 * - diff says the range was deleted (or the mapped slice degenerates to
 *   whitespace) → that claim is verified before orphaning, because
 *   `diff_cleanupSemantic` can merge two neighbouring rewrites into one
 *   delete/insert that swallows untouched text between them. Verification is
 *   strictly about *verbatim survival*: the exactness tier of the §6 ladder
 *   (rungs 1–2 only — fuzzy would re-attach genuinely deleted text to a
 *   similar sibling), and the match must overlap text this edit inserted.
 *   An exact match sitting wholly in unedited text is a pre-existing
 *   doppelgänger of the deleted range, not the range surviving — orphan.
 *   Only a verified survivor re-attaches (`remapped`); otherwise the last
 *   selector is kept verbatim for history/git and the anchor reported
 *   `orphaned` (SPEC §6 step 5).
 *
 * Never mutates its input; always returns a new map whose selectors carry
 * `prefix`/`suffix` as strings (the contract's `TextQuoteSelector` shape).
 */
export function reconcileAnchors(
  oldBody: string,
  newBody: string,
  anchors: AnchorsMap,
): ReconcileResult {
  const nextAnchors: Record<string, TextQuoteSelector> = {};
  const report: ReconcileReport = { unchanged: [], remapped: [], orphaned: [] };
  const entries = sortedEntries(anchors);
  if (entries.length === 0) return { anchors: nextAnchors, report };

  const mapper = computeOffsetMapper(oldBody, newBody);
  const isBlank = (range: Range): boolean =>
    newBody.slice(range.start, range.end).trim().length === 0;

  // The diff claims this anchor's text is gone (or its slice is untrustworthy).
  // Before detaching the thread, check for verbatim survival — and only
  // verbatim survival. Exact rungs (1–2) prove the characters are still there;
  // fuzzy would "verify" a deleted bullet/paragraph/table row via its
  // look-alike sibling and silently re-attach the thread to text its author
  // never commented on. The survivor must also overlap inserted text: this
  // edit put it there (a merged rewrite, a cut-and-paste, a reorder). An exact
  // match lying wholly in unedited text existed before the edit — a
  // doppelgänger of the deleted range, not the range itself — so the deletion
  // stands and the anchor orphans with its selector preserved for history
  // (SPEC §6 step 5).
  const verifiedSurvivor = (selector: TextQuoteSelector): Range | null => {
    const revived = resolveAnchorExact(newBody, selector);
    if (revived === null || isBlank(revived) || !mapper.touchesInsertion(revived)) return null;
    return revived;
  };

  // The emitted selector for a range is (slice, context at the range), so
  // resolving it must land back on the range itself. A mapped slice whose
  // window has an identical earlier occurrence would send every subsequent
  // lookup — the UI highlighting the thread — to the wrong copy; such a slice
  // is not trusted (SERVER-012 acceptance criterion 2's self-round-trip).
  const sliceRoundTrips = (range: Range): boolean => {
    const candidate = {
      exact: newBody.slice(range.start, range.end),
      ...computeContext(newBody, range.start, range.end),
    };
    const resolved = resolveAnchorExact(newBody, candidate);
    return resolved !== null && resolved.start === range.start && resolved.end === range.end;
  };

  // A rewritten slice with no kinship to its original is not in-place-edit
  // evidence (SERVER-012 round 3). An honest in-place rewrite keeps a
  // resemblance to what it rewrote; a slice that is *unrelated* to its
  // original — similarity below the engine's fuzzy threshold — while the
  // original text sits verbatim at another location is the mapper keeping a
  // byte offset across a relocation and handing the anchor whatever paragraph
  // occupies it now (swap two paragraphs: the anchor quotes the paragraph
  // that moved *in*, while its own survives untouched elsewhere). Such a
  // slice is voided and the anchor re-places through the adjudicated chain:
  // a relocated survivor necessarily sits in inserted text (an EQUAL survivor
  // would have been followed by the monotone mapping), so it re-attaches; a
  // pre-existing doppelgänger in unedited text fails insertion-overlap and
  // the anchor orphans. An occurrence wholly *inside* the slice is kinship by
  // containment (the superset shape), not a disjoint survivor — it never
  // voids here. Both signals are deterministic; fuzzy resolution never runs.
  const lacksKinship = (range: Range, exact: string): boolean => {
    let at = newBody.indexOf(exact);
    let survivesOutside = false;
    while (at !== -1 && !survivesOutside) {
      survivesOutside = at < range.start || at + exact.length > range.end;
      at = newBody.indexOf(exact, at + 1);
    }
    if (!survivesOutside) return false;
    const slice = newBody.slice(range.start, range.end);
    const maxLen = Math.max(slice.length, exact.length);
    const maxDistance = Math.floor(maxLen * (1 - FUZZY_THRESHOLD));
    return boundedLevenshtein(slice, exact, maxDistance) > maxDistance;
  };

  type Draft = {
    id: string;
    /** Original selector, normalized to the contract shape — what an orphan keeps. */
    selector: TextQuoteSelector;
    /** Where the selector resolved in `oldBody` (`null`: orphaned before this edit). */
    oldRange: Range | null;
    /** Where the anchor lives in `newBody` (`null`: orphaned). */
    newRange: Range | null;
  };

  const drafts: Draft[] = entries.map(([id, input]) => {
    const selector: TextQuoteSelector = {
      exact: input.exact,
      prefix: input.prefix ?? "",
      suffix: input.suffix ?? "",
    };
    const oldRange = resolveAnchor(oldBody, selector);
    if (oldRange === null) return { id, selector, oldRange, newRange: null };

    const classification = mapper.classify(oldRange);
    if (classification === "deleted") {
      return { id, selector, oldRange, newRange: verifiedSurvivor(selector) };
    }

    const mapped = snapRange(newBody, {
      start: mapper.mapStart(oldRange.start),
      end: mapper.mapEnd(oldRange.end),
    });
    // A range edited down to nothing is a deletion in all but name; a slice
    // rewritten through a boundary-straddling replacement, failing its own
    // round-trip, or bearing no kinship to the text it claims to have
    // rewritten is dishonest (see above). All take the deleted-claim
    // verification path — exact-only, orphan last, fuzzy never. A slice equal
    // to the old exact is verbatim survival, not a rewrite claim, and an
    // `equal` classification can't be straddled (a straddling DELETE would
    // have touched the range) — kept anchors pay for none of these checks.
    const suspect =
      isBlank(mapped) ||
      (classification === "partial" &&
        newBody.slice(mapped.start, mapped.end) !== selector.exact &&
        (mapper.straddledByReplacement(oldRange) ||
          !sliceRoundTrips(mapped) ||
          lacksKinship(mapped, selector.exact)));
    return { id, selector, oldRange, newRange: suspect ? verifiedSurvivor(selector) : mapped };
  });

  // Cross-anchor honesty checks — the reorder family (SERVER-012 round 2).
  // The diff can stuff an entire relocated paragraph into a replacement wholly
  // *inside* a range, so its slice is boundary-respecting, round-trips, and is
  // still another anchor's text; segment accounting cannot see it (the foreign
  // content arrives as INSERT text, and monotonicity keeps foreign EQUAL text
  // out of every mapped span). Two signals expose it, both exempting pairs
  // whose old ranges already overlapped (nested/overlapping anchors are legal
  // and move together):
  // - collision: `mapStart`/`mapEnd` are monotone, so anchors with disjoint
  //   old ranges can only overlap in `newBody` when a slice misattributed
  //   text;
  // - capture: a rewritten slice containing a disjoint co-anchor's entire
  //   `exact` is quoting that anchor's text, wherever it itself landed.
  // A slice still equal to its old exact is verbatim survival and outranks the
  // rewritten claim, so only the rewritten side is re-routed — through the
  // same adjudicated chain, whose re-attachment must not itself collide.
  const overlapping = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;
  const oldDisjoint = (a: Draft, b: Draft): boolean =>
    a.oldRange === null || b.oldRange === null || !overlapping(a.oldRange, b.oldRange);
  const collides = (draft: Draft, range: Range): boolean =>
    drafts.some(
      (other) =>
        other.id !== draft.id &&
        other.newRange !== null &&
        overlapping(range, other.newRange) &&
        oldDisjoint(draft, other),
    );
  const captures = (draft: Draft, slice: string): boolean =>
    drafts.some(
      (other) =>
        other.id !== draft.id &&
        other.oldRange !== null &&
        oldDisjoint(draft, other) &&
        slice.includes(other.selector.exact),
    );
  const isRewritten = (draft: Draft): boolean =>
    draft.newRange !== null &&
    newBody.slice(draft.newRange.start, draft.newRange.end) !== draft.selector.exact;
  const conflicted = drafts.filter((draft) => {
    if (!isRewritten(draft) || draft.newRange === null) return false;
    return (
      collides(draft, draft.newRange) ||
      captures(draft, newBody.slice(draft.newRange.start, draft.newRange.end))
    );
  });
  // Void every dishonest slice first — detection is against the pass-1
  // snapshot, so the outcome is independent of processing order — then
  // re-place each in sorted order.
  for (const draft of conflicted) draft.newRange = null;
  for (const draft of conflicted) {
    const revived = verifiedSurvivor(draft.selector);
    if (revived !== null && !collides(draft, revived)) draft.newRange = revived;
  }

  for (const draft of drafts) {
    if (draft.newRange === null) {
      nextAnchors[draft.id] = draft.selector;
      report.orphaned.push(draft.id);
      continue;
    }
    const slice = newBody.slice(draft.newRange.start, draft.newRange.end);
    const context = computeContext(newBody, draft.newRange.start, draft.newRange.end);
    nextAnchors[draft.id] = { exact: slice, ...context };
    const untouched =
      slice === draft.selector.exact &&
      context.prefix === draft.selector.prefix &&
      context.suffix === draft.selector.suffix;
    (untouched ? report.unchanged : report.remapped).push(draft.id);
  }
  return { anchors: nextAnchors, report };
}
