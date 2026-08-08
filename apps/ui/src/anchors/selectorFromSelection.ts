import { selectorAt, type SelectionRange, type TextQuoteSelector } from "../editor/selection";
import { pmRangeToMd, type PmRange } from "./offsetMap";
import { fileRangeOf } from "./rebase";
import type { DocumentTrace } from "./traceCache";

/**
 * A selection, described the way SPEC.md §6 describes an anchor.
 *
 * The quote comes from the **markdown source**, never from the DOM's text: a
 * selection reading `30-year fixed quote` on screen is `**30-year fixed**
 * quote` in the file, and the server's resolution ladder matches literally
 * before it matches anything else. Nothing here trims or normalises whitespace
 * for the same reason — a tidied quote is a quote of a document that does not
 * exist.
 *
 * This replaces the interim locator in `editor/selection.ts` for the one caller
 * that has a trace. That module finds the selected text in the body and answers
 * `null` when the two spellings differ; this one maps positions through the
 * serializer's emission trace and is exact wherever the trace is — including
 * across markup, across blocks, and inside a `[[ref]]`.
 *
 * **And "the markdown source" means the file, not the printing of it** (UI-068).
 * The trace addresses the canonical serialization, which is the same string as
 * the file only when the file was last written by this editor; on any other file
 * — a blank line after the frontmatter fence, a padded table, a setext heading —
 * slicing the trace's markdown quotes bytes the document does not contain. So
 * the range crosses into the file's own spelling before anything is sliced.
 * {@link fileRangeOf} carries it and states why there rather than here.
 */

export interface AnchorSelection {
  /** Offsets into the file the quote was taken from, not into the printing. */
  readonly range: SelectionRange;
  readonly selector: TextQuoteSelector;
}

/** Why a selection could not become an anchor. */
export type SelectionRefusal =
  /** It quotes no text at all: a caret, or nothing but syntax and whitespace. */
  | "no-quote"
  /** Its words could not be named in the file's own spelling of the document. */
  | "not-in-file";

/**
 * The capture, or the reason there is none.
 *
 * A refusal carries its reason because the two are not the same news: one is
 * "select some words", the other is "the file and the screen disagree about
 * this passage", and a comment path that says the first for both is lying about
 * the second (UI-068).
 */
export type SelectionCapture =
  | { readonly ok: true; readonly selection: AnchorSelection }
  | { readonly ok: false; readonly reason: SelectionRefusal };

/**
 * Whether a selection can carry a comment at all.
 *
 * An empty or whitespace-only quote is not an anchor: `exact` is `min(1)` on
 * the wire, and a selector of spaces would resolve against every indent in the
 * document (sprint-011 TEST-103).
 */
export function isCommentable(quote: string): boolean {
  return quote.trim() !== "";
}

const NO_QUOTE = { ok: false, reason: "no-quote" } as const;
const NOT_IN_FILE = { ok: false, reason: "not-in-file" } as const;

/**
 * The selector for a ProseMirror range, quoted out of `file`.
 *
 * `file` is the markdown the server will resolve this selector against — the
 * parent's body as it sits on disk, or, when the editor holds edits the disk
 * does not, the printing the pending save is about to write there. Passing
 * `source.markdown` is the degenerate case and costs nothing: the crossing is
 * the identity when the two strings are equal, so a canonical document takes
 * exactly the path it always did.
 */
export function selectorFromSelection(
  source: DocumentTrace,
  range: PmRange,
  file: string,
): SelectionCapture {
  const md = pmRangeToMd(source.trace, range);
  if (md === null) return NO_QUOTE;
  if (!isCommentable(source.markdown.slice(md.start, md.end))) return NO_QUOTE;
  const inFile = fileRangeOf(source.markdown, file, md);
  if (inFile === null) return NOT_IN_FILE;
  // The crossing can widen a range to a run, and a run of whitespace is no more
  // anchorable than a whitespace selection was.
  if (!isCommentable(file.slice(inFile.start, inFile.end))) return NOT_IN_FILE;
  return { ok: true, selection: { range: inFile, selector: selectorAt(file, inFile) } };
}
