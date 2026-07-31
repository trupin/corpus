// A hit's **address**: where inside a document the best-matching passage sits
// (SPEC.md §7 Retrieval discipline, §9.2 — "the heading path of the
// best-matching passage").
//
// Two halves, and both are deliberately small:
//
// - **Locating the passage.** FTS5 already chose it — `snippet()` returns the
//   window it considers best, with the matched terms delimited. So the passage
//   is found by looking that window back up in the indexed text rather than by
//   re-running the query's matching logic in TypeScript, which would be a second
//   implementation of the thing FTS5 is for.
// - **Walking the headings above it.** A line scanner over ATX headings that
//   skips fenced code, built on `core/code.ts` exactly as the turn scanner
//   (`core/turns.ts`) already is. No markdown AST parser is added to the server
//   (sprint-019 Adjudication 5): the server's dependency set is a packaging
//   decision, and a heading is one of the few markdown constructs a line
//   scanner reads as well as a parser would.
//
// Setext headings (`Title` over `=====`) are not headings here. The product
// writes ATX everywhere — the editor serializes `##`, §6 pins turn headings as
// `## author · ts` — and a scanner that guessed at underlines would have to
// decide whether a table rule under a paragraph is a heading. An address that
// falls back to the document title is a worse address; a wrong one is a lie.

import { fencedCodeRanges, overlapsRange, splitLines } from "../core/code.js";
import { SNIPPET_CLOSE, SNIPPET_ELLIPSIS, SNIPPET_OPEN } from "../docs/index.js";

/** ATX headings, CommonMark's rule: up to three leading spaces, then 1–6 `#`. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;

/** A closing sequence (`## Rates ##`) is decoration, not part of the heading. */
const CLOSING_SEQUENCE = /[ \t]+#+[ \t]*$/;

const headingText = (raw: string | undefined): string =>
  (raw ?? "").replace(CLOSING_SEQUENCE, "").trim();

/**
 * A `snippet()` result, unmarked: the plain text FTS5 returned, plus where each
 * matched term begins inside it.
 *
 * The offsets matter because the window can span a heading — a snippet may
 * begin with the tail of a section's last paragraph and continue past `## Rates`
 * into the match. Addressing the *window* rather than the match would then name
 * the previous section.
 */
export interface UnmarkedSnippet {
  readonly text: string;
  /** Offsets of the delimited terms within {@link text}, in order. */
  readonly matchOffsets: readonly number[];
}

/** Whether this column matched at all — how a column FTS5 merely previewed is told apart. */
export const hasMatch = (snippet: UnmarkedSnippet): boolean => snippet.matchOffsets.length > 0;

/**
 * Which match the address is taken from when the window carries several: the
 * one at the **centre of the matched cluster** — the offset with the smallest
 * total distance to the others.
 *
 * `snippet()` returns the region of the column with the most matched terms,
 * padded with context; a window can therefore span several sections and carry a
 * stray occurrence in the padding. Addressing the *first* match would name
 * whatever section that padding spilled out of, and a document whose query terms
 * finally appear together three lines later would be addressed by the paragraph
 * above them. The medoid is where the terms actually converge, which is the
 * passage the ranking was about.
 *
 * Ties go to the earlier offset, so the choice is deterministic — and a window
 * with one match is that match, unconditionally.
 */
export function primaryMatch(snippet: UnmarkedSnippet): number | null {
  const offsets = snippet.matchOffsets;
  let best: number | null = null;
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const offset of offsets) {
    let spread = 0;
    for (const other of offsets) spread += Math.abs(offset - other);
    if (spread < bestSpread) {
      best = offset;
      bestSpread = spread;
    }
  }
  return best;
}

/**
 * Strips the two delimiters `snippet()` was given, recording where each marked
 * term ended up. The delimiters cannot occur in the indexed text — the
 * projection strips them at index time (`toIndexableText`) — so every one seen
 * here was inserted by `snippet()`.
 */
export function unmarkSnippet(raw: string): UnmarkedSnippet {
  let text = "";
  const matchOffsets: number[] = [];
  for (const part of raw.split(SNIPPET_OPEN)) {
    const close = part.indexOf(SNIPPET_CLOSE);
    if (close < 0) {
      text += part;
      continue;
    }
    matchOffsets.push(text.length);
    text += part.slice(0, close) + part.slice(close + SNIPPET_CLOSE.length);
  }
  return { text, matchOffsets };
}

/** Trims the elision markers `snippet()` adds where it cut the text. */
function withoutElisions(text: string): { readonly text: string; readonly dropped: number } {
  let start = 0;
  let end = text.length;
  while (text.startsWith(SNIPPET_ELLIPSIS, start)) start += SNIPPET_ELLIPSIS.length;
  while (end > start && text.endsWith(SNIPPET_ELLIPSIS, end)) end -= SNIPPET_ELLIPSIS.length;
  return { text: text.slice(start, end), dropped: start };
}

/**
 * Where in `text` the passage `snippet` was cut from begins — the offset of the
 * matched term itself.
 *
 * A ladder, because `snippet()`'s output is a substring of the column text with
 * two edits: markers around matched terms (removed by {@link unmarkSnippet}) and
 * an elision marker at each end it truncated. The first rung assumes both edits;
 * the second assumes the elisions were the text's own; the third gives up on the
 * window and looks for the matched term alone. `0` is the honest floor — it
 * addresses the document itself, which is what a hit whose match is in the
 * *title* deserves anyway.
 */
export function locatePassage(text: string, snippet: UnmarkedSnippet): number {
  const matchOffset = primaryMatch(snippet);
  if (matchOffset === null) return 0;

  const trimmed = withoutElisions(snippet.text);
  const windows: readonly (readonly [string, number])[] = [
    [trimmed.text, matchOffset - trimmed.dropped],
    [snippet.text, matchOffset],
  ];
  for (const [window, offsetInWindow] of windows) {
    if (window === "" || offsetInWindow < 0) continue;
    const at = text.indexOf(window);
    if (at >= 0) return at + offsetInWindow;
  }

  const term = matchedTerm(snippet, matchOffset);
  if (term !== "") {
    const at = text.indexOf(term);
    if (at >= 0) return at;
    const lowered = text.toLowerCase().indexOf(term.toLowerCase());
    if (lowered >= 0) return lowered;
  }
  return 0;
}

/** The delimited term at `offset`, unmarked. */
function matchedTerm(snippet: UnmarkedSnippet, offset: number): string {
  const rest = snippet.text.slice(offset);
  const space = rest.search(/\s/u);
  return space < 0 ? rest : rest.slice(0, space);
}

/**
 * The enclosing headings of the passage at `offset`, outermost first.
 *
 * A stack, so a `### C` under `## B` under `# A` reports all three while a
 * sibling `## D` further down replaces `B` rather than nesting under it. A
 * heading the match itself sits *on* is enclosing (its line starts before the
 * match), which is what makes a query that hit a heading address that section.
 *
 * Empty headings (`##` with no text) close their level without naming it: they
 * pop what they must and contribute nothing to print.
 */
export function enclosingHeadings(text: string, offset: number): string[] {
  const fenced = fencedCodeRanges(text);
  const stack: { readonly level: number; readonly text: string }[] = [];

  for (const line of splitLines(text)) {
    if (line.start >= offset) break;
    const match = ATX_HEADING.exec(line.text);
    if (match === null) continue;
    if (overlapsRange(fenced, line.start, line.contentEnd)) continue;

    const level = (match[1] ?? "").length;
    while ((stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    stack.push({ level, text: headingText(match[2]) });
  }
  return stack.map((heading) => heading.text).filter((heading) => heading !== "");
}
