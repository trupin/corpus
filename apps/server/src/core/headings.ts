/**
 * Markdown heading structure for a body, fence-aware.
 *
 * Two features of retrieval read it: ranked search addresses a hit by the
 * headings enclosing its passage (SPEC.md §9.2), and the semantic index splits
 * a body into chunks along the same boundaries (§9.1). Keeping the scan here
 * means the two can never disagree about what a heading is — a `## Rates`
 * inside a fenced block is text in both, or in neither.
 *
 * The rule is CommonMark's ATX subset the rest of the codebase already applies:
 * up to three leading spaces, then one to six `#`, then whitespace and a name; a
 * closing sequence (`## Rates ##`) is decoration; four spaces of indent make it
 * an indented code block, not a heading; setext underlines are not headings.
 * Fenced regions come from {@link fencedCodeRanges}, the same source
 * `core/turns.ts` and `core/refs.ts` use.
 *
 * Offsets are UTF-16 code-unit offsets and ranges are half-open `[start, end)`,
 * as everywhere else in `core/`.
 */

import { fencedCodeRanges, overlapsRange, splitLines } from "@corpus/contract";

/** ATX headings, CommonMark's rule: up to three leading spaces, then 1–6 `#`. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;

/** A closing sequence (`## Rates ##`) is decoration, not part of the heading. */
const CLOSING_SEQUENCE = /[ \t]+#+[ \t]*$/;

const headingText = (raw: string | undefined): string =>
  (raw ?? "").replace(CLOSING_SEQUENCE, "").trim();

/**
 * A stretch of a body under one heading, from that heading's own line to the
 * next heading that closes it.
 *
 * `headings` is the enclosing stack, outermost first, with empty headings
 * (`##` with no text) dropped: they close their level without naming it. A
 * body's sections are contiguous and cover it exactly, so a chunker can slice
 * along them without re-deriving a single boundary.
 */
export interface HeadingSection {
  /** Enclosing heading names, outermost first; empty above the first heading. */
  readonly headings: readonly string[];
  /** Offset of this section's own heading line, or `0` for the leading section. */
  readonly start: number;
  readonly end: number;
}

/**
 * Every section of `text`, in document order, contiguous and covering it.
 *
 * The first section is the text above the first heading — the preamble — and
 * carries no headings at all; it is present even when empty so a caller can
 * treat the list as a partition. A heading a passage sits *on* encloses it,
 * which is what makes a query that hit a heading address that heading's own
 * section.
 */
export function headingSections(text: string): HeadingSection[] {
  const fenced = fencedCodeRanges(text);
  const sections: HeadingSection[] = [];
  const stack: { readonly level: number; readonly text: string }[] = [];
  let start = 0;
  let headings: string[] = [];

  for (const line of splitLines(text)) {
    const match = ATX_HEADING.exec(line.text);
    if (match === null) continue;
    if (overlapsRange(fenced, line.start, line.contentEnd)) continue;

    sections.push({ headings, start, end: line.start });
    const level = (match[1] ?? "").length;
    while ((stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    stack.push({ level, text: headingText(match[2]) });
    headings = stack.map((heading) => heading.text).filter((heading) => heading !== "");
    start = line.start;
  }
  sections.push({ headings, start, end: text.length });
  return sections;
}

/**
 * The enclosing headings of the passage at `offset`, outermost first — the
 * headings of the section it falls in.
 *
 * Defined in terms of {@link headingSections} rather than beside it: "which
 * headings enclose this offset" and "where does this section start" are the
 * same question asked twice, and answering them from one scan is what keeps the
 * search address and the chunk address identical.
 */
export function enclosingHeadings(text: string, offset: number): readonly string[] {
  const sections = headingSections(text);
  const found = sections.find((section) => offset >= section.start && offset < section.end);
  return found?.headings ?? sections[sections.length - 1]?.headings ?? [];
}
