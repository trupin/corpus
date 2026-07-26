import { snapRange } from "./code-points.js";
import { findFuzzyRange } from "./fuzzy.js";
import type { AnchorsMap, Range, TextQuoteSelectorInput } from "./types.js";

export type ResolveOptions = {
  /** Previous known offset of the range (reconciliation supplies it); biases fuzzy tie-breaks. */
  hint?: number;
};

/**
 * Resolve a text-quote selector against a body via the SPEC.md §6 ladder:
 *
 * 1. Exact match of `prefix + exact + suffix` (first occurrence — with the
 *    context included, ambiguity at this level is vanishingly rare). Skipped
 *    when the selector has no context at all, since it would degenerate to a
 *    first-occurrence guess and defeat rung 2's uniqueness requirement.
 * 2. `exact` alone, when it occurs exactly once (overlapping occurrences count).
 * 3. Fuzzy: highest-similarity window at or above `FUZZY_THRESHOLD`.
 * 4. Unresolved → `null` (the thread is orphaned, never guessed at).
 */
export function resolveAnchor(
  body: string,
  selector: TextQuoteSelectorInput,
  options: ResolveOptions = {},
): Range | null {
  const { exact } = selector;
  if (exact.length === 0 || body.length === 0) return null;
  const prefix = selector.prefix ?? "";
  const suffix = selector.suffix ?? "";

  if (prefix.length > 0 || suffix.length > 0) {
    const index = body.indexOf(prefix + exact + suffix);
    if (index !== -1) {
      const start = index + prefix.length;
      return snapRange(body, { start, end: start + exact.length });
    }
  }

  const first = body.indexOf(exact);
  if (first !== -1 && body.indexOf(exact, first + 1) === -1) {
    return snapRange(body, { start: first, end: first + exact.length });
  }

  const hint = Math.max(0, Math.min(options.hint ?? 0, body.length));
  return findFuzzyRange(body, { exact, prefix, suffix, hint });
}

/**
 * Resolve a whole document's anchors in one pass. Iteration is in sorted-id
 * order so the result is deterministic regardless of the map's insertion order.
 */
export function resolveAnchors(body: string, anchors: AnchorsMap): Record<string, Range | null> {
  const resolved: Record<string, Range | null> = {};
  for (const [id, selector] of sortedEntries(anchors)) {
    resolved[id] = resolveAnchor(body, selector);
  }
  return resolved;
}

/** Entries sorted by id with a plain code-unit comparison — never locale-dependent. */
export function sortedEntries(anchors: AnchorsMap): [string, TextQuoteSelectorInput][] {
  return Object.entries(anchors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
