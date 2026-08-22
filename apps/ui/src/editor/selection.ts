/**
 * What the 💬 Comment button hands over — the seam UI-007 anchors into.
 *
 * SPEC.md §6 anchors a thread with a **text-quote selector**: `{exact, prefix,
 * suffix}`, resolved against the markdown body rather than against any position
 * the editor happens to hold. So the payload carries both readings: the
 * ProseMirror positions (exact, and meaningless to the server) and the markdown
 * offsets with their surrounding context (what `POST /api/threads` takes).
 *
 * **The offsets are located, not mapped.** A true ProseMirror-position →
 * markdown-offset map is UI-007's crux and is derived from the serializer's
 * emission trace; what is here is the honest interim: find the selected text in
 * the serialized body, disambiguated by how many times it already occurred
 * before the selection. It is exact for prose — the case the Comment button is
 * for — and it answers `null` rather than guessing when the selection spans
 * markup the body spells differently (a selection crossing `**bold**` reads as
 * `bold text` in the editor and `**bold** text` in the file). A `null` range is
 * information UI-007 can act on; a wrong one is an anchor pointing at the wrong
 * sentence.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Characters of context on each side. Enough to disambiguate, short enough to store. */
export const SELECTOR_CONTEXT = 32;

/**
 * What is said when the document moved between capturing a range and using it.
 *
 * The context menu (SPEC.md §10) captures a range when it opens and acts on it
 * when an item is chosen; anything can land in between, including the agent's
 * write arriving over SSE. Both users of that pattern say the same thing.
 */
export const STALE_SELECTION_NOTICE =
  "The document changed under the menu — reselect and try again.";

/**
 * Whether `doc` still carries exactly `text` between `from` and `to`.
 *
 * The bounds are checked first: `textBetween` throws on a position past the end
 * of the document, and a document can shrink under an open menu — a refusal is
 * the answer there, not an exception (PR #13 review, MINOR).
 */
export function rangeStillReads(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  text: string,
): boolean {
  if (from < 0 || to > doc.content.size) return false;
  return doc.textBetween(from, to, "\n", "") === text;
}

export interface TextQuoteSelector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

export interface SelectionRange {
  readonly start: number;
  readonly end: number;
}

export interface EditorSelection {
  readonly docId: string;
  /** ProseMirror positions, for a caller that holds the same editor state. */
  readonly from: number;
  readonly to: number;
  /** The selected text as the editor reads it: marks resolved, markup absent. */
  readonly text: string;
  /** The serialized markdown the offsets below index into. */
  readonly body: string;
  /** Character offsets into `body`, or `null` when the text could not be located. */
  readonly range: SelectionRange | null;
  /** SPEC.md §6's selector, or `null` for the same reason. */
  readonly selector: TextQuoteSelector | null;
}

/** Non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) return count;
    count += 1;
    cursor = at + needle.length;
  }
}

/** The index of the `nth` (zero-based) non-overlapping occurrence, or `-1`. */
export function nthIndexOf(haystack: string, needle: string, nth: number): number {
  if (needle === "" || nth < 0) return -1;
  let cursor = 0;
  for (let seen = 0; ; seen += 1) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) return -1;
    if (seen === nth) return at;
    cursor = at + needle.length;
  }
}

/**
 * Where the selected text sits in the body.
 *
 * `textBefore` is the editor's plain text preceding the selection; the count of
 * earlier occurrences in it is what picks the right one of several identical
 * phrases. Falls back to the first occurrence when the counted one is not there
 * — better an anchor on the wrong instance of a repeated word than no anchor —
 * and to `null` when the text is not in the body at all.
 */
export function locateSelection(
  body: string,
  textBefore: string,
  exact: string,
): SelectionRange | null {
  if (exact === "") return null;
  const occurrence = countOccurrences(textBefore, exact);
  const at = nthIndexOf(body, exact, occurrence);
  const start = at === -1 ? body.indexOf(exact) : at;
  if (start === -1) return null;
  return { start, end: start + exact.length };
}

export function selectorAt(body: string, range: SelectionRange): TextQuoteSelector {
  return {
    exact: body.slice(range.start, range.end),
    prefix: body.slice(Math.max(0, range.start - SELECTOR_CONTEXT), range.start),
    suffix: body.slice(range.end, range.end + SELECTOR_CONTEXT),
  };
}

export interface BuildSelectionInput {
  readonly docId: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly textBefore: string;
  readonly body: string;
}

export function buildSelection(input: BuildSelectionInput): EditorSelection {
  const range = locateSelection(input.body, input.textBefore, input.text);
  return {
    docId: input.docId,
    from: input.from,
    to: input.to,
    text: input.text,
    body: input.body,
    range,
    selector: range === null ? null : selectorAt(input.body, range),
  };
}
