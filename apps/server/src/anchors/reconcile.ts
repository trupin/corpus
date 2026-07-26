import { snapRange } from "./code-points.js";
import { computeContext } from "./context.js";
import { computeOffsetMapper } from "./diff.js";
import { resolveAnchor, sortedEntries } from "./resolve.js";
import type { AnchorsMap, ReconcileReport, ReconcileResult, TextQuoteSelector } from "./types.js";

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
 *   `exact`, context recomputed, reported `remapped` — unless the mapped slice
 *   is empty/whitespace-only, which is a deletion in all but name;
 * - range entirely deleted → the last selector is kept verbatim for
 *   history/git and the anchor is reported `orphaned`.
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

    const oldRange = resolveAnchor(oldBody, selector);
    if (oldRange === null) {
      orphan();
      continue;
    }
    if (mapper.classify(oldRange) === "deleted") {
      orphan();
      continue;
    }

    const mapped = snapRange(newBody, {
      start: mapper.mapStart(oldRange.start),
      end: mapper.mapEnd(oldRange.end),
    });
    const slice = newBody.slice(mapped.start, mapped.end);
    if (slice.trim().length === 0) {
      orphan();
      continue;
    }

    const context = computeContext(newBody, mapped.start, mapped.end);
    nextAnchors[id] = { exact: slice, ...context };
    // A classification of "equal" guarantees the mapped slice is the old
    // `exact` (all characters survive contiguously); the slice comparison is
    // a defensive invariant, downgrading to `remapped` rather than emitting a
    // selector that does not match the body.
    const untouched =
      slice === selector.exact &&
      context.prefix === selector.prefix &&
      context.suffix === selector.suffix;
    (untouched ? report.unchanged : report.remapped).push(id);
  }
  return { anchors: nextAnchors, report };
}
