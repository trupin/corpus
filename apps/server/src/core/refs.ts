import { DocumentIdSchema, codeRanges, overlapsRange } from "@corpus/contract";

/**
 * Inline references (SPEC.md §5) are id-based: `[[doc_a1b2c3]]`, or
 * `[[doc_a1b2c3|as text]]` to override the rendered label. Nobody types them by
 * hand — composers autocomplete by title and insert the id — so the scanner's
 * job is only to find them for the projection's `links` table and for the
 * unresolved-reference warning (§14).
 */
export type DocumentRef = {
  /** Target document id — always a contract-valid `doc_*` / `th_*` id. */
  readonly id: string;
  /** Display override from the `|alias` form; `null` for the bare form. */
  readonly alias: string | null;
  /** UTF-16 offsets such that `text.slice(start, end)` is the whole `[[…]]`. */
  readonly start: number;
  readonly end: number;
};

/**
 * Deliberately loose on the id: what counts as a document id is the contract's
 * call, and each candidate is checked against `DocumentIdSchema` below rather
 * than re-encoded here. A candidate that is not a document id is left alone —
 * `[[not an id]]` is ordinary prose, not a broken reference.
 */
const REF_CANDIDATE = /\[\[([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+)(?:\|([^\]\n]*))?\]\]/g;

/**
 * Extract every reference outside fenced blocks and inline code spans, in
 * source order. Malformed brackets simply do not match — extraction never
 * throws on a body.
 */
export const extractRefs = (text: string): DocumentRef[] => {
  const opaque = codeRanges(text);
  const refs: DocumentRef[] = [];
  for (const match of text.matchAll(REF_CANDIDATE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsRange(opaque, start, end)) continue;
    const id = match[1];
    if (id === undefined || !DocumentIdSchema.safeParse(id).success) continue;
    refs.push({ id, alias: match[2] ?? null, start, end });
  }
  return refs;
};

/** The distinct ids referenced by `text`, in first-occurrence order. */
export const referencedIds = (text: string): string[] => [
  ...new Set(extractRefs(text).map((ref) => ref.id)),
];
