import { snapRange } from "./code-points.js";
import { computeContext } from "./context.js";
import { computeOffsetMapper } from "./diff.js";
import { resolveAnchor, sortedEntries } from "./resolve.js";
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
 *   `exact`, context recomputed, reported `remapped`;
 * - diff says the range was deleted (or the mapped slice degenerates to
 *   whitespace) → that claim is verified by re-resolving the original selector
 *   against `newBody` through the §6 ladder before orphaning. §6 defines an
 *   orphan as a selector that *no longer resolves* — the diff is only the
 *   mechanism, and `diff_cleanupSemantic` can merge two neighbouring rewrites
 *   into one delete/insert that swallows untouched text between them. A
 *   selector that still resolves re-attaches there (`remapped`); only when the
 *   ladder also fails is the last selector kept verbatim for history/git and
 *   the anchor reported `orphaned`.
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

    // The diff claims this range's text is gone. Verify against the body
    // itself (§6: orphaned means the selector no longer resolves) before
    // detaching the thread; the mapped start biases fuzzy tie-breaks toward
    // where the edit left the neighbourhood.
    const reattachOrOrphan = (): void => {
      const revived = resolveAnchor(newBody, selector, {
        hint: mapper.mapStart(oldRange.start),
      });
      if (revived === null || isBlank(revived)) {
        orphan();
        return;
      }
      emitAt(revived);
    };

    if (mapper.classify(oldRange) === "deleted") {
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
    // A classification of "equal" guarantees the mapped slice is the old
    // `exact` (all characters survive contiguously); `emitAt`'s slice
    // comparison is a defensive invariant, downgrading to `remapped` rather
    // than emitting a selector that does not match the body.
    emitAt(mapped);
  }
  return { anchors: nextAnchors, report };
}
