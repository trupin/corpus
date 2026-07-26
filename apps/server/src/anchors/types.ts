import type { TextQuoteSelector } from "@corpus/contract";

/**
 * Selector as accepted on input. `prefix`/`suffix` may be absent (the raw file
 * form) or present as strings (the contract's post-parse form, which defaults
 * them to `""`). The engine treats absent and `""` identically and always
 * emits the contract shape — both context fields present as strings — so its
 * output satisfies `TextQuoteSelectorSchema` directly.
 */
export type TextQuoteSelectorInput = Pick<TextQuoteSelector, "exact"> &
  Partial<Pick<TextQuoteSelector, "prefix" | "suffix">>;

/** A document's anchors, keyed by `anc_*` id (SPEC.md §6). */
export type AnchorsMap = Record<string, TextQuoteSelectorInput>;

/**
 * Half-open character range `[start, end)` in UTF-16 code units — the offsets
 * `String.prototype.slice` uses. Every range the engine returns falls on
 * code-point boundaries (never inside a surrogate pair).
 */
export type Range = { start: number; end: number };

/** Which anchors an edit left alone, moved/rewrote, or detached. */
export type ReconcileReport = {
  unchanged: string[];
  remapped: string[];
  orphaned: string[];
};

export type ReconcileResult = {
  anchors: Record<string, TextQuoteSelector>;
  report: ReconcileReport;
};

export type { TextQuoteSelector };
