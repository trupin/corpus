import { splitsSurrogatePair } from "./code-points.js";

/**
 * Context window in UTF-16 code units on each side of a range (SPEC.md §6).
 * Cuts are clipped at body boundaries and expanded by one unit when they would
 * land between the halves of a surrogate pair.
 */
export const CONTEXT_WINDOW = 32;

/**
 * Compute `prefix`/`suffix` for the range `[start, end)` verbatim from the
 * body — no whitespace normalization — so the resolution ladder's contextual
 * lookup remains a plain `indexOf` of concatenated substrings.
 */
export function computeContext(
  body: string,
  start: number,
  end: number,
): { prefix: string; suffix: string } {
  let from = Math.max(0, start - CONTEXT_WINDOW);
  if (splitsSurrogatePair(body, from)) from -= 1;
  let to = Math.min(body.length, end + CONTEXT_WINDOW);
  if (splitsSurrogatePair(body, to)) to += 1;
  return { prefix: body.slice(from, start), suffix: body.slice(end, to) };
}
