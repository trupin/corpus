// Where an anchor's `prefix`/`suffix` come from at creation (SPEC.md §6,
// SERVER-071).
//
// A text-quote selector is a quote **plus its surroundings in the file**. The
// quote a caller sends is text it is looking at, so it can be checked against
// the document; the context is a claim about bytes it is not holding, and there
// is no way to check it against anything except the file itself. Storing it as
// sent therefore records the caller's *belief* about the document rather than
// the document — and when the caller is the agent, which quotes from what it
// read rather than from a byte range it holds, that belief is routinely wrong
// or (more often) simply absent.
//
// Absent is the sharp case, because every use the engine makes of context is
// silently a no-op for it. Rung 1 of §6's ladder (`prefix + exact + suffix`) is
// skipped outright for a context-free selector, leaving rung 2's bare
// uniqueness test; `findFuzzyRange`'s `contextAgreement` tie-break scores zero
// against every candidate, so the surroundings stop separating an edited
// passage from its lookalike sibling in exactly the corpus shapes — lists,
// tables, templates — where they look alike. SERVER-055's post-mortem measured
// this on the population the agent creates. The fix is upstream of all of it: at
// creation the document is in hand, so the context is not a claim at all. The
// server reads it off the parent's own bytes and the caller's copy never
// reaches disk.
//
// **This is not resolution, and must not grow into it.** A selector whose quote
// is absent from the parent still creates its thread — §6 calls that anchor
// orphaned and orphaned is a normal state of a living corpus, not a rejected
// request (see `create.ts`'s header). What is refused here is a *different*
// failure: a quote that names more than one passage is an underspecified
// request, not a request about text that moved. Guessing the first occurrence
// would silently attach the conversation to a passage the caller may never have
// meant, and §6's ordering — "a visible orphan beats a silent misattachment" —
// puts an error at creation, which is cheap and visible, above a mis-anchored
// thread discovered months later.

import type { TextQuoteSelector } from "@corpus/contract";
import { computeContext } from "../anchors/index.js";
import { validationError } from "../docs/index.js";

/**
 * Occurrences of `needle` in `haystack`, counted **overlapping** and stopped at
 * `limit` — the same counting rung 2 of the resolution ladder does, so "unique
 * here" and "unique there" mean the same thing. The cap is why a one-character
 * quote in a large body costs nothing: the count is only ever consulted as
 * none / one / more than one.
 */
export function countOccurrences(haystack: string, needle: string, limit: number): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    if (count >= limit) return count;
    from = at + 1;
  }
}

/** First occurrence of `needle`, or `-1`. Named for symmetry with the counter. */
const firstOccurrence = (haystack: string, needle: string): number => haystack.indexOf(needle);

/**
 * Where in `body` the selector's quote sits, or `null` when it is not there.
 *
 * The caller's context is used for one thing only — deciding *which* occurrence
 * was meant when the quote repeats — and never stored. A framing that does not
 * appear in the file (the agent's usual case) is discarded rather than held
 * against the request: the quote alone still identifies the passage whenever it
 * is unique.
 *
 * Throws the contract's `400` when the request names more than one passage.
 */
export function locateAnchor(body: string, selector: TextQuoteSelector): number | null {
  const { exact, prefix, suffix } = selector;

  if (prefix !== "" || suffix !== "") {
    const framed = prefix + exact + suffix;
    const framedCount = countOccurrences(body, framed, 2);
    if (framedCount === 1) return firstOccurrence(body, framed) + prefix.length;
    if (framedCount > 1) {
      ambiguous(
        "the quoted text and the context sent with it occur more than once in the parent document",
      );
    }
  }

  const count = countOccurrences(body, exact, 2);
  if (count === 1) return firstOccurrence(body, exact);
  if (count > 1) {
    ambiguous(
      "the quoted text occurs more than once in the parent document; send `prefix`/`suffix` " +
        "copied from the file around the occurrence you mean",
    );
  }
  return null;
}

function ambiguous(message: string): never {
  validationError(message, [{ path: "selector.exact", message }]);
}

/**
 * The stored shape of an anchor over a range **whose location is already
 * known**: the body's own bytes for `exact`, framed by `computeContext`.
 *
 * This is the single definition of "what a selector looks like once the server
 * has written it", and it has two callers that arrive at a location by different
 * evidence: {@link contextualizeSelector}, which finds the range by matching the
 * caller's quote (thread creation, SERVER-071), and the re-attach repair, which
 * is *handed* the range by the person who chose it (SERVER-072). Keeping the
 * computation here rather than restating it on the repair path is what makes
 * "a repaired anchor is in the shape a save would have left it in" a fact about
 * the code instead of a claim about two similar-looking expressions.
 *
 * `computeContext` is the one spelling of "context window around a range" the
 * server has — reconciliation rewrites context with it after every edit — so
 * every anchor the server writes, however it got its range, is shaped the same.
 */
export function selectorForRange(body: string, start: number, end: number): TextQuoteSelector {
  return { exact: body.slice(start, end), ...computeContext(body, start, end) };
}

/**
 * The selector as it will be stored: the caller's `exact` verbatim, with
 * `prefix`/`suffix` **read off the parent's own bytes** around it.
 *
 * A quote that is absent from `body` keeps whatever context the request carried:
 * there are no bytes to read it from, the anchor is orphaned at birth either
 * way, and inventing context for it would be the same fabrication this function
 * exists to stop.
 */
export function contextualizeSelector(
  body: string,
  selector: TextQuoteSelector,
): TextQuoteSelector {
  const start = locateAnchor(body, selector);
  if (start === null) return selector;
  // The slice `selectorForRange` takes is the caller's `exact` byte for byte —
  // `locateAnchor` found the range by `indexOf` of that very string — so routing
  // through it keeps the quote verbatim *and* keeps one definition of the shape.
  return selectorForRange(body, start, start + selector.exact.length);
}
