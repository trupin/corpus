import { snapRange } from "./code-points.js";
import { findFuzzyRange } from "./fuzzy.js";
import type { AnchorsMap, Range, TextQuoteSelectorInput } from "./types.js";

export type ResolveOptions = {
  /** Previous known offset of the range (reconciliation supplies it); biases fuzzy tie-breaks. */
  hint?: number;
};

/**
 * Rungs 1–2 of the SPEC.md §6 ladder — the exactness tier:
 *
 * 1. Exact match of `prefix + exact + suffix` (first occurrence — with the
 *    context included, ambiguity at this level is vanishingly rare). Skipped
 *    when the selector has no context at all, since it would degenerate to a
 *    first-occurrence guess and defeat rung 2's uniqueness requirement.
 * 2. `exact` alone, when it occurs exactly once (overlapping occurrences count).
 *
 * Split out from {@link resolveAnchor} because reconciliation's deleted-claim
 * verification must stop here: exact rungs prove *verbatim* survival, which is
 * the only evidence strong enough to overrule the diff's word that a range was
 * deleted. Fuzzy similarity would "find" a deleted paragraph's look-alike
 * sibling and silently re-attach its thread.
 */
export function resolveAnchorExact(body: string, selector: TextQuoteSelectorInput): Range | null {
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

  return null;
}

/**
 * Resolve a text-quote selector against a body via the SPEC.md §6 ladder:
 *
 * 1–2. The exactness tier ({@link resolveAnchorExact}).
 * 3. Fuzzy: highest-similarity window at or above `FUZZY_THRESHOLD` **whose
 *    surroundings corroborate the selector's declared context** — see
 *    `fuzzy.ts`. That gate is what makes the rung safe to run wherever the
 *    question is asked, including at render time (SERVER-055): a deleted
 *    bullet's parallel sibling scores far above the threshold on the quote
 *    alone and fails on its neighbours.
 * 4. Unresolved → `null` (the thread is orphaned, never guessed at).
 *
 * This is **the** answer to "where does this selector point in this body" —
 * the reader, the projector, §14's checker and reconciliation's own lookup in
 * `oldBody` all call it, so none of them can disagree about what resolves.
 * {@link resolveAnchorExact} is not a cheaper variant of it: it answers the
 * different, diff-backed question reconciliation asks when it must *disprove* a
 * deletion, where similarity is inadmissible evidence.
 */
export function resolveAnchor(
  body: string,
  selector: TextQuoteSelectorInput,
  options: ResolveOptions = {},
): Range | null {
  const exactRange = resolveAnchorExact(body, selector);
  if (exactRange !== null) return exactRange;

  const { exact } = selector;
  if (exact.length === 0 || body.length === 0) return null;
  const hint = Math.max(0, Math.min(options.hint ?? 0, body.length));
  return findFuzzyRange(body, {
    exact,
    prefix: selector.prefix ?? "",
    suffix: selector.suffix ?? "",
    hint,
  });
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
