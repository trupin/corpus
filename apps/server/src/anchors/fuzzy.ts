import DiffMatchPatch from "diff-match-patch";
import { snapRange } from "./code-points.js";
import type { Range } from "./types.js";

/** Minimum normalized similarity (1 − levenshtein/maxLen) for a fuzzy match. */
export const FUZZY_THRESHOLD = 0.75;
/** At most this many candidate windows are scored per resolution. */
export const MAX_FUZZY_CANDIDATES = 64;
/** Fuzzy is skipped entirely (→ orphaned) above this `exact` length. */
export const MAX_FUZZY_EXACT_LENGTH = 4096;
/** Bitap patterns are capped at 32 code units (diff-match-patch `Match_MaxBits`). */
export const BITAP_PATTERN_LIMIT = 32;
/** Length of the sampled shingles used to seed candidates when bitap fails. */
export const SHINGLE_LENGTH = 16;

const MATCH_THRESHOLD = 0.5;
const MATCH_DISTANCE = 1000;

export type FuzzyQuery = {
  exact: string;
  prefix: string;
  suffix: string;
  /** Previous known offset of the range, when the caller has one; else 0. */
  hint: number;
};

/**
 * Levenshtein distance between `a` and `b`, banded: returns the exact distance
 * when it is ≤ `maxDistance`, otherwise `maxDistance + 1`. Deterministic —
 * no timeouts — because reconciliation output is committed to git.
 */
export function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  const cap = maxDistance + 1;
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDistance) return cap;
  if (m === 0) return n;
  if (n === 0) return m;

  let previous: number[] = new Array<number>(n + 1).fill(cap);
  let current: number[] = new Array<number>(n + 1).fill(cap);
  for (let j = 0; j <= Math.min(n, maxDistance); j++) previous[j] = j;

  for (let i = 1; i <= m; i++) {
    const from = Math.max(1, i - maxDistance);
    const to = Math.min(n, i + maxDistance);
    current[0] = Math.min(i, cap);
    if (from > 1) current[from - 1] = cap;
    let rowMin = cap;
    const codeA = a.charCodeAt(i - 1);
    for (let j = from; j <= to; j++) {
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
    if (to + 1 <= n) current[to + 1] = cap;
    if (rowMin >= cap) return cap;
    [previous, current] = [current, previous];
  }
  return Math.min(previous[n] ?? cap, cap);
}

/** Length of the longest common suffix of `declaredPrefix` and `body.slice(0, at)`. */
function prefixAgreement(body: string, at: number, declaredPrefix: string): number {
  let count = 0;
  while (
    count < declaredPrefix.length &&
    at - 1 - count >= 0 &&
    declaredPrefix.charCodeAt(declaredPrefix.length - 1 - count) === body.charCodeAt(at - 1 - count)
  ) {
    count++;
  }
  return count;
}

/** Length of the longest common prefix of `declaredSuffix` and `body.slice(at)`. */
function suffixAgreement(body: string, at: number, declaredSuffix: string): number {
  let count = 0;
  while (
    count < declaredSuffix.length &&
    at + count < body.length &&
    declaredSuffix.charCodeAt(count) === body.charCodeAt(at + count)
  ) {
    count++;
  }
  return count;
}

/** Bitap pattern: the head of `exact`, capped at 32 units, never ending on a lone high surrogate. */
function bitapPattern(exact: string): string {
  let pattern = exact.slice(0, BITAP_PATTERN_LIMIT);
  const last = pattern.charCodeAt(pattern.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) pattern = pattern.slice(0, -1);
  return pattern;
}

/**
 * Candidate window offsets: a diff-match-patch bitap seed near `hint` first,
 * then occurrences of shingles sampled from `exact` (head, quarters, tail) so
 * a body whose edits fall inside the bitap pattern still yields candidates.
 * Deterministic generation order; capped at `MAX_FUZZY_CANDIDATES`.
 */
function candidateOffsets(body: string, exact: string, hint: number): number[] {
  const seen = new Set<number>();
  const candidates: number[] = [];
  const push = (offset: number): void => {
    const clamped = Math.max(0, Math.min(offset, body.length));
    if (!seen.has(clamped) && candidates.length < MAX_FUZZY_CANDIDATES) {
      seen.add(clamped);
      candidates.push(clamped);
    }
  };

  const dmp = new DiffMatchPatch();
  dmp.Match_Threshold = MATCH_THRESHOLD;
  dmp.Match_Distance = MATCH_DISTANCE;
  const pattern = bitapPattern(exact);
  if (pattern.length > 0) {
    const location = dmp.match_main(body, pattern, hint);
    if (location !== -1) push(location);
  }

  const length = Math.min(SHINGLE_LENGTH, exact.length);
  const lastPosition = exact.length - length;
  const samplePositions = [
    0,
    Math.floor(lastPosition / 4),
    Math.floor(lastPosition / 2),
    Math.floor((3 * lastPosition) / 4),
    lastPosition,
  ];
  for (const position of samplePositions) {
    const shingle = exact.slice(position, position + length);
    let index = body.indexOf(shingle);
    while (index !== -1 && candidates.length < MAX_FUZZY_CANDIDATES) {
      push(index - position);
      index = body.indexOf(shingle, index + 1);
    }
  }
  return candidates;
}

type ScoredCandidate = {
  offset: number;
  score: number;
  contextAgreement: number;
  hintDistance: number;
};

/**
 * Rung 3 of the resolution ladder: score fixed-length windows at candidate
 * offsets by normalized Levenshtein similarity and accept the best window at
 * or above `FUZZY_THRESHOLD`. Ties break by (a) prefix/suffix agreement with
 * the window's actual surroundings, (b) proximity to `hint`, (c) earliest
 * offset — in that order, so the result is deterministic.
 */
export function findFuzzyRange(body: string, query: FuzzyQuery): Range | null {
  const { exact, prefix, suffix, hint } = query;
  if (exact.length === 0 || exact.length > MAX_FUZZY_EXACT_LENGTH || body.length === 0) {
    return null;
  }

  let best: ScoredCandidate | null = null;
  for (const offset of candidateOffsets(body, exact, hint)) {
    const window = body.slice(offset, offset + exact.length);
    if (window.length === 0) continue;
    const maxLen = Math.max(window.length, exact.length);
    const maxDistance = Math.floor(maxLen * (1 - FUZZY_THRESHOLD));
    const distance = boundedLevenshtein(window, exact, maxDistance);
    if (distance > maxDistance) continue;
    const candidate: ScoredCandidate = {
      offset,
      score: 1 - distance / maxLen,
      contextAgreement:
        prefixAgreement(body, offset, prefix) +
        suffixAgreement(body, offset + window.length, suffix),
      hintDistance: Math.abs(offset - hint),
    };
    if (best === null || beats(candidate, best)) best = candidate;
  }

  if (best === null) return null;
  return snapRange(body, {
    start: best.offset,
    end: Math.min(best.offset + exact.length, body.length),
  });
}

function beats(a: ScoredCandidate, b: ScoredCandidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.contextAgreement !== b.contextAgreement) return a.contextAgreement > b.contextAgreement;
  if (a.hintDistance !== b.hintDistance) return a.hintDistance < b.hintDistance;
  return a.offset < b.offset;
}
