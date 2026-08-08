import type { BodyRange } from "@corpus/contract";

/**
 * Where an orphaned comment *could* belong — offered to a person, decided by a
 * person (SPEC.md §6; SERVER-059 phase B, UI-086).
 *
 * ## Why a search runs here at all, when one was banned from the read path
 *
 * SERVER-055 put a similarity measure on the resolution ladder and was reverted
 * for misattaching 8 of 12 deletion shapes. SERVER-059 then established the
 * failure as a **construction** rather than a measurement: deleting
 * `- Review the Q2 report by Friday` from a Q1–Q4 list, and renaming that same
 * line to `Q3` while deleting the old Q3 line, produce the *same* after-state
 * from the *same* before-state and demand opposite correct answers. A reader
 * sees only the after-state, so the evidence that separates them does not exist
 * at read time and no threshold can conjure it.
 *
 * Nothing in this module contradicts that, because this module **never
 * answers**. The same arithmetic is admissible here and inadmissible there for
 * one reason, and it is worth stating flatly because a future reader will meet
 * this file long before they meet that history:
 *
 * > On a read path, a similarity score becomes an attachment nobody watched
 * > happen. Here it becomes a **suggestion a person confirms**. The deciding
 * > evidence is not the score — it is the memory of the human who wrote the
 * > comment, which is exactly the evidence the corpus never held.
 *
 * So: {@link findReattachCandidates} enumerates; a person picks; the server is
 * told a **range**, never an index into this list (CONTRACT-041). If this list
 * and the server disagreed, the range would still denote the passage it always
 * denoted.
 *
 * ## Complete, not ranked
 *
 * The generation is exhaustive rather than seeded. It runs Sellers' variant of
 * the edit-distance DP — free start position, cost read off the final row — over
 * the whole body, so **every** substring within {@link maxEdits} of the quote is
 * represented by a candidate. That is a stronger guarantee than the
 * pigeonhole-complete route SERVER-059 named, and it is chosen for the same
 * reason: a person can dismiss a bad candidate but cannot summon a missing one,
 * and a silently-capped list reads as "these are the only places".
 *
 * The server's `findFuzzyRange` is deliberately **not** reused, despite doing
 * similar arithmetic. It seeds windows from a bitap probe plus five sampled
 * shingles and returns the single best — both halves are wrong here. Its
 * candidate set is incomplete by construction (a passage none of the six probes
 * touches is invisible), and its return type is the one thing this surface must
 * never produce: an answer.
 *
 * Candidates come back in **document order** with no score attached — not as a
 * presentation choice but so that no ordering can be mistaken for a
 * recommendation. Where the list cannot be complete, it says so
 * ({@link CandidateLimit}) rather than quietly returning a prefix.
 */

/**
 * Similarity floor, held equal to the server's `FUZZY_THRESHOLD` so that "close
 * enough to be worth showing a person" and "close enough that reconciliation
 * would have carried it forward" are the same number in both halves of the
 * codebase.
 */
export const SIMILARITY_FLOOR = 0.75;

/** Quotes longer than this are not searched for; the caller is told why. */
export const MAX_QUOTE_LENGTH = 4096;

/** At most this many candidates are returned; a longer list is reported truncated. */
export const MAX_CANDIDATES = 24;

/**
 * Ceiling on DP cell visits. The search is synchronous and runs on a click, so
 * a pathological document must refuse honestly rather than freeze the tab for a
 * second. Sized so that every realistic workspace document passes: the bound is
 * `body.length × (maxEdits + 2)`, which for a 200 KB document and a 200-character
 * quote is 10.4M.
 */
export const SEARCH_CELL_BUDGET = 24_000_000;

/** Upper bound on the text shown on each side of a candidate, in characters. */
export const CONTEXT_BUDGET = 220;

/** How many whole lines of context are shown on each side of a candidate. */
export const CONTEXT_LINES = 2;

/** A range some other thread's anchor already resolves over. */
export interface OccupiedRange {
  readonly threadId: string;
  readonly range: BodyRange;
}

/**
 * One place the comment could go.
 *
 * **There is deliberately no score on this type.** The person is being asked to
 * recognise their own comment's home, and a number tells them nothing they can
 * check — it only lends a guess the authority of arithmetic. What they get is
 * the passage and enough of its surroundings to tell it from its siblings, which
 * is the evidence a human can actually act on. The distance is used inside this
 * module to collapse overlapping alignments of the same passage and is discarded
 * at the boundary.
 */
export interface ReattachCandidate {
  readonly range: BodyRange;
  /** The document's own bytes over `range` — sent back as `expectedText`. */
  readonly text: string;
  /** Text immediately before `range`, whole lines where they fit. */
  readonly before: string;
  /** Text immediately after `range`, whole lines where they fit. */
  readonly after: string;
  /** True when `before` does not reach the start of the document. */
  readonly precededByMore: boolean;
  /** True when `after` does not reach the end of the document. */
  readonly followedByMore: boolean;
  /**
   * The thread already anchored over this text, or `null`.
   *
   * Such a candidate is shown and refused rather than dropped: SPEC.md §6
   * forbids two threads on disjoint text claiming overlapping text, and the
   * server enforces it (`409 range-overlaps`), but hiding the passage would make
   * the list quietly incomplete at exactly the place the person is most likely
   * to be looking.
   */
  readonly takenBy: string | null;
}

/**
 * Why the list in hand is not everything the document holds. `null` in
 * {@link CandidateSearch.limit} is the claim that it *is*.
 */
export type CandidateLimit =
  | { readonly kind: "count"; readonly shown: number; readonly found: number }
  | { readonly kind: "quote-too-long"; readonly length: number; readonly max: number }
  | { readonly kind: "document-too-large" };

export interface CandidateSearch {
  /** In document order. Never ranked, never pre-selected. */
  readonly candidates: readonly ReattachCandidate[];
  readonly limit: CandidateLimit | null;
}

export interface CandidateSearchInput {
  /** The parent document's body, in `ResolvedAnchor.range`'s coordinate space. */
  readonly body: string;
  /** The orphan's preserved `selector.exact` (SPEC.md §6 keeps it byte-for-byte). */
  readonly quote: string;
  readonly occupied?: readonly OccupiedRange[];
}

/**
 * How far a passage may have drifted and still be worth showing.
 *
 * A quote shorter than four characters tolerates nothing: at that length a
 * single edit's worth of slack matches most of the alphabet, and a list of
 * near-everything is a list of nothing.
 */
export function maxEdits(quote: string): number {
  return Math.floor(quote.length * (1 - SIMILARITY_FLOOR));
}

/** Cell visits {@link findReattachCandidates} would spend on this pair. */
function searchCost(bodyLength: number, quote: string): number {
  return bodyLength * (maxEdits(quote) + 2);
}

interface Alignment {
  readonly start: number;
  readonly end: number;
  readonly distance: number;
}

/**
 * End offsets at which some substring of `body` is within `k` edits of `quote`,
 * with that distance — the final row of Sellers' DP.
 *
 * Ukkonen's cutoff keeps the column short: rows past the last one still within
 * `k` cannot influence anything below `k`, so they are never visited. The
 * column is reseeded to `0` at row 0 on every step, which is what makes the
 * start position free and therefore makes this a *search* rather than a
 * comparison.
 */
function matchEnds(body: string, quote: string, k: number): { end: number; distance: number }[] {
  const m = quote.length;
  const n = body.length;
  const cap = k + 1;
  let previous: number[] = new Array<number>(m + 1);
  let current: number[] = new Array<number>(m + 1).fill(cap);
  for (let i = 0; i <= m; i++) previous[i] = i;

  const ends: { end: number; distance: number }[] = [];
  let last = Math.min(k, m);

  for (let j = 1; j <= n; j++) {
    current[0] = 0;
    const limit = Math.min(m, last + 1);
    const bodyCode = body.charCodeAt(j - 1);
    for (let i = 1; i <= limit; i++) {
      const cost = quote.charCodeAt(i - 1) === bodyCode ? 0 : 1;
      let value = Math.min((current[i - 1] ?? cap) + 1, (previous[i - 1] ?? cap) + cost);
      if (i <= last) value = Math.min(value, (previous[i] ?? cap) + 1);
      current[i] = Math.min(value, cap);
    }
    last = limit;
    while (last > 0 && (current[last] ?? cap) > k) last--;
    const distance = current[m] ?? cap;
    if (last === m && distance <= k) ends.push({ end: j, distance });
    [previous, current] = [current, previous];
  }
  return ends;
}

/**
 * One end per run of adjacent ends: the cheapest, leftmost on a tie.
 *
 * A single passage produces a short run of acceptable end offsets — the same
 * match, stopping a character early or late. Two *different* passages never
 * abut, so collapsing runs separates siblings (the Q1–Q4 case) while collapsing
 * an alignment's own jitter.
 */
function runMinima(ends: readonly { end: number; distance: number }[]): {
  end: number;
  distance: number;
}[] {
  const picked: { end: number; distance: number }[] = [];
  let best: { end: number; distance: number } | null = null;
  let previousEnd = -2;
  for (const candidate of ends) {
    if (best !== null && candidate.end !== previousEnd + 1) {
      picked.push(best);
      best = null;
    }
    if (best === null || candidate.distance < best.distance) best = candidate;
    previousEnd = candidate.end;
  }
  if (best !== null) picked.push(best);
  return picked;
}

/** Edit distance between `a` and `b`, giving up (returning `cap`) past `cap - 1`. */
function boundedDistance(a: string, b: string, cap: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) >= cap) return cap;
  let previous: number[] = new Array<number>(n + 1);
  let current: number[] = new Array<number>(n + 1).fill(cap);
  for (let j = 0; j <= n; j++) previous[j] = Math.min(j, cap);
  for (let i = 1; i <= m; i++) {
    current[0] = Math.min(i, cap);
    let rowMin = current[0];
    const codeA = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = codeA === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? cap) + 1,
        (current[j - 1] ?? cap) + 1,
        (previous[j - 1] ?? cap) + cost,
        cap,
      );
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin >= cap) return cap;
    [previous, current] = [current, previous];
  }
  return previous[n] ?? cap;
}

/**
 * The start offset of the alignment ending at `end`.
 *
 * Recovered by scanning the only window lengths the DP could have accepted —
 * `quote.length ± k` — rather than by carrying a back-pointer table, which would
 * cost a full matrix in memory for a value needed a handful of times. Ties
 * prefer the window closest to the quote's own length, then the later start, so
 * a match never quietly grows a leading fragment of its neighbour.
 */
function alignmentAt(body: string, quote: string, end: number, k: number): Alignment | null {
  const m = quote.length;
  let best: Alignment | null = null;
  for (let length = Math.max(1, m - k); length <= m + k; length++) {
    const start = end - length;
    if (start < 0) continue;
    const distance = boundedDistance(body.slice(start, end), quote, k + 1);
    if (distance > k) continue;
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && Math.abs(length - m) < Math.abs(best.end - best.start - m)) ||
      (distance === best.distance &&
        Math.abs(length - m) === Math.abs(best.end - best.start - m) &&
        start > best.start)
    ) {
      best = { start, end, distance };
    }
  }
  return best;
}

/**
 * Alignments of the same passage collapse into one candidate.
 *
 * Two candidates that share any text are two spellings of one place, and
 * offering both would ask the person to choose between an answer and the same
 * answer shifted by a character. The cheaper alignment wins; an equal tie keeps
 * the earlier one, so the result is a function of the document rather than of
 * iteration order.
 */
function withoutOverlaps(alignments: readonly Alignment[]): Alignment[] {
  const kept: Alignment[] = [];
  for (const alignment of alignments) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && alignment.start < previous.end) {
      if (alignment.distance < previous.distance) kept[kept.length - 1] = alignment;
      continue;
    }
    kept.push(alignment);
  }
  return kept;
}

/** Start of the line containing `at`. */
function lineStart(body: string, at: number): number {
  return body.lastIndexOf("\n", at - 1) + 1;
}

/** End of the line containing `at`, exclusive of its newline. */
function lineEnd(body: string, at: number): number {
  const found = body.indexOf("\n", at);
  return found === -1 ? body.length : found;
}

/**
 * Surrounding text: whole lines, bounded by {@link CONTEXT_LINES} on each side
 * and by {@link CONTEXT_BUDGET} characters.
 *
 * Whole lines matter more than an exact character count: the shapes this repair
 * exists for are parallel siblings — list items, table rows, task lines,
 * numbered steps — and a person tells one from another by reading the lines
 * around it. A window cut mid-line shows the differences and hides which row
 * they belong to.
 *
 * **Both bounds are there because either alone reads badly**, which the first
 * real-app drill showed: on a document shorter than the character budget, every
 * candidate's context was the entire document, so four siblings rendered as the
 * same block four times with a different word marked — technically complete, and
 * useless for telling them apart at a glance. The line cap keeps a candidate the
 * size of the decision; the character cap keeps a single enormous paragraph from
 * defeating the line cap.
 */
function surroundings(
  body: string,
  range: BodyRange,
): Pick<ReattachCandidate, "before" | "after" | "precededByMore" | "followedByMore"> {
  const floor = Math.max(0, range.start - CONTEXT_BUDGET);
  let from = Math.max(lineStart(body, range.start), floor);
  for (let line = 0; line < CONTEXT_LINES && from > floor; line++) {
    const previous = lineStart(body, from - 1);
    if (previous < floor) break;
    from = previous;
  }

  const ceiling = Math.min(body.length, range.end + CONTEXT_BUDGET);
  let to = Math.min(lineEnd(body, range.end), ceiling);
  for (let line = 0; line < CONTEXT_LINES && to < ceiling; line++) {
    const next = lineEnd(body, to + 1);
    if (next > ceiling) break;
    to = next;
  }

  return {
    before: body.slice(from, range.start),
    after: body.slice(range.end, to),
    precededByMore: from > 0,
    followedByMore: to < body.length,
  };
}

function occupantOf(range: BodyRange, occupied: readonly OccupiedRange[]): string | null {
  for (const other of occupied) {
    if (other.range.start < range.end && range.start < other.range.end) return other.threadId;
  }
  return null;
}

/**
 * Every place in `body` a comment quoting `quote` could plausibly have meant,
 * in document order.
 *
 * The empty list is a real answer and the caller must render it as one: when
 * nothing in the document resembles the quote, saying so plainly is better than
 * relaxing the floor until something appears. A weak candidate is worse than no
 * candidate, because it invites a click — and the click writes a selector that
 * is then indistinguishable from a healthy one.
 */
export function findReattachCandidates({
  body,
  quote,
  occupied = [],
}: CandidateSearchInput): CandidateSearch {
  if (quote.length === 0 || body.length === 0) return { candidates: [], limit: null };
  if (quote.length > MAX_QUOTE_LENGTH) {
    return {
      candidates: [],
      limit: { kind: "quote-too-long", length: quote.length, max: MAX_QUOTE_LENGTH },
    };
  }
  if (searchCost(body.length, quote) > SEARCH_CELL_BUDGET) {
    return { candidates: [], limit: { kind: "document-too-large" } };
  }

  const k = maxEdits(quote);
  const alignments: Alignment[] = [];
  for (const { end } of runMinima(matchEnds(body, quote, k))) {
    const alignment = alignmentAt(body, quote, end, k);
    if (alignment !== null) alignments.push(alignment);
  }

  const found = withoutOverlaps(alignments);
  const shown = found.slice(0, MAX_CANDIDATES);
  const candidates = shown.map((alignment) => {
    const range: BodyRange = { start: alignment.start, end: alignment.end };
    return {
      range,
      text: body.slice(range.start, range.end),
      ...surroundings(body, range),
      takenBy: occupantOf(range, occupied),
    } satisfies ReattachCandidate;
  });

  return {
    candidates,
    limit:
      found.length > shown.length
        ? { kind: "count", shown: shown.length, found: found.length }
        : null,
  };
}
