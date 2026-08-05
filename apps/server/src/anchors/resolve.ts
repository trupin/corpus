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
 * This is **the reader's resolver** — `docs/read.ts`, the projector's
 * `anchors.resolved_offset` and §14's `checkSeams` all stop here, and
 * reconciliation's deleted-claim verification does too. Exact rungs prove
 * *verbatim* survival, which is the only evidence admissible when the caller
 * cannot see what the edit did (a reader never can) or must overrule the diff's
 * word that a range was deleted. See {@link resolveAnchor} for why fuzzy
 * similarity is not evidence of survival.
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
 * 3. Fuzzy: highest-similarity window at or above `FUZZY_THRESHOLD` (`fuzzy.ts`).
 * 4. Unresolved → `null` (the thread is orphaned, never guessed at).
 *
 * **Callers: reconciliation only.** The one caller is `reconcileAnchors`, which
 * uses it to locate a selector in `oldBody` — the body the selector was written
 * against, where a fuzzy hit means "the selector has drifted from its own text",
 * and where the answer is then checked against the diff before anything moves.
 * No reader may call this. `docs/read.ts`, the projector and §14's checker stop
 * at {@link resolveAnchorExact}.
 *
 * That split is not a performance choice, and it is not the accident SERVER-055
 * took it for. Rung 3 measures *similarity*, and similarity is evidence of
 * survival only for a caller that can also see what the edit did. A reader sees
 * one body. Given a list, a table or a template — text whose items are
 * *supposed* to look alike — the passage most similar to a deleted item is its
 * surviving sibling, and the sibling's declared context is near-identical too,
 * so no context test separates them either. Measured on the shapes in
 * `resolve.test.ts` → "rung 3 is inadmissible on a read path": deleting one item
 * from a four-item list lands the thread on its neighbour, and *editing* one row
 * of a parallel table lands it on the row below. Both are the silent
 * misattachment SPEC §6 forbids outright ("a visible orphan beats a silent
 * misattachment… never to a lookalike"), and the second is worse than orphaning
 * the very case rung 3 would have been wired in to serve.
 *
 * The bodies do not carry the answer. Deleting `- Review the Q2 report by
 * Friday` from a Q1–Q4 list, and renaming that same line to `Q3` while deleting
 * the old Q3 line, produce the **same** `oldBody`, the same `newBody` and the
 * same selector, with opposite correct outcomes. §6 resolves the tie in one
 * direction: orphan.
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
 *
 * Inherits {@link resolveAnchor}'s caller restriction: this runs the fuzzy rung,
 * so it is not the function a reader wants. `docs/read.ts` resolves a document's
 * anchors with {@link resolveAnchorExact}, per-anchor, for that reason.
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
