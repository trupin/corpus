import { snapRange } from "./code-points.js";
import { computeContext } from "./context.js";
import { computeOffsetMapper } from "./diff.js";
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
 *   slice is trustworthy*. When a DELETE+INSERT replacement straddles a range
 *   boundary, the mapper grants the range replacement text that also replaces
 *   content outside it (the diff aligns a deleted paragraph against a
 *   near-identical edited sibling), producing truncated selectors or another
 *   anchor's words; such a slice is rejected and the anchor takes the same
 *   verification path as a deletion claim (SERVER-012);
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
  for (const [id, input] of entries) {
    const selector: TextQuoteSelector = {
      exact: input.exact,
      prefix: input.prefix ?? "",
      suffix: input.suffix ?? "",
    };
    const orphan = (): void => {
      nextAnchors[id] = selector;
      report.orphaned.push(id);
    };
    /** Emit the selector for `[start, end)` of `newBody` and file the report bucket. */
    const emitAt = (range: Range): void => {
      const slice = newBody.slice(range.start, range.end);
      const context = computeContext(newBody, range.start, range.end);
      nextAnchors[id] = { exact: slice, ...context };
      const untouched =
        slice === selector.exact &&
        context.prefix === selector.prefix &&
        context.suffix === selector.suffix;
      (untouched ? report.unchanged : report.remapped).push(id);
    };
    const isBlank = (range: Range): boolean =>
      newBody.slice(range.start, range.end).trim().length === 0;

    const oldRange = resolveAnchor(oldBody, selector);
    if (oldRange === null) {
      orphan();
      continue;
    }

    // The diff claims this range's text is gone. Before detaching the thread,
    // check for verbatim survival — and only verbatim survival. Exact rungs
    // (1–2) prove the characters are still there; fuzzy would "verify" a
    // deleted bullet/paragraph/table row via its look-alike sibling and
    // silently re-attach the thread to text its author never commented on.
    // The survivor must also overlap inserted text: this edit put it there
    // (a merged rewrite, a cut-and-paste). An exact match lying wholly in
    // unedited text existed before the edit — a doppelgänger of the deleted
    // range, not the range itself — so the deletion stands and the anchor
    // orphans with its selector preserved for history (SPEC §6 step 5).
    const reattachOrOrphan = (): void => {
      const revived = resolveAnchorExact(newBody, selector);
      if (revived === null || isBlank(revived) || !mapper.touchesInsertion(revived)) {
        orphan();
        return;
      }
      emitAt(revived);
    };

    const classification = mapper.classify(oldRange);
    if (classification === "deleted") {
      reattachOrOrphan();
      continue;
    }

    const mapped = snapRange(newBody, {
      start: mapper.mapStart(oldRange.start),
      end: mapper.mapEnd(oldRange.end),
    });
    if (isBlank(mapped)) {
      // A range edited down to nothing is a deletion in all but name — same
      // verification before orphaning.
      reattachOrOrphan();
      continue;
    }
    if (classification === "partial" && mapper.straddledByReplacement(oldRange)) {
      // The mapped slice swallowed replacement text that also replaces content
      // outside the range — it may be truncated or carry a neighbour's words,
      // so the mapper's in-place-edit evidence is void. The adjudicated ladder
      // still applies, in order: exact-only verification second, orphan last,
      // fuzzy never (an `equal` classification can't be straddled — a
      // boundary-straddling DELETE would have touched the range — so kept
      // anchors never pay for this check).
      reattachOrOrphan();
      continue;
    }
    // A classification of "equal" guarantees the mapped slice is the old
    // `exact` (all characters survive contiguously); `emitAt`'s slice
    // comparison is a defensive invariant, downgrading to `remapped` rather
    // than emitting a selector that does not match the body.
    emitAt(mapped);
  }
  return { anchors: nextAnchors, report };
}
