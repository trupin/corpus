export { isWellFormedText, snapRange, splitsSurrogatePair } from "./code-points.js";
export { CONTEXT_WINDOW, computeContext } from "./context.js";
export { DIFF_TIMEOUT_SECONDS, computeOffsetMapper } from "./diff.js";
export type { OffsetMapper, RangeClass } from "./diff.js";
export {
  BITAP_PATTERN_LIMIT,
  FUZZY_THRESHOLD,
  MAX_FUZZY_CANDIDATES,
  MAX_FUZZY_EXACT_LENGTH,
  SHINGLE_LENGTH,
  boundedLevenshtein,
  findFuzzyRange,
} from "./fuzzy.js";
export type { FuzzyQuery } from "./fuzzy.js";
export { reconcileAnchors } from "./reconcile.js";
export { resolveAnchor, resolveAnchors } from "./resolve.js";
export type { ResolveOptions } from "./resolve.js";
export type {
  AnchorsMap,
  Range,
  ReconcileReport,
  ReconcileResult,
  TextQuoteSelector,
  TextQuoteSelectorInput,
} from "./types.js";
