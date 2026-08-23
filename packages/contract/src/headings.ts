/**
 * Markdown heading structure for a body, fence-aware — **the one scan**, and
 * the join that renders its result as an address.
 *
 * Four features read it, in three packages: ranked search addresses a hit by the
 * headings enclosing its passage (SPEC.md §9.2), the semantic index splits a
 * body into chunks along the same boundaries (§9.1), the thread context pack
 * quotes a section by them (§7), and `corpus doc show --headings` / `--section`
 * hands an agent the bytes under one of them. Keeping the scan here means none
 * of the four can disagree about what a heading is — a `## Rates` inside a
 * fenced block is text in all of them, or in none.
 *
 * **Why the contract owns it** (CONTRACT-070, and `./code.ts`'s reasoning
 * before it). It began in `apps/server/src/core/`, which is where the on-disk
 * formats are parsed — but a heading rule is a *format* rule, and the format has
 * readers outside that application. `apps/cli` may not import `apps/server`, so
 * with the scan over there the only way for the CLI to address a section was a
 * second copy of it, guarded by a test that read the server's **source text**
 * and compared strings. That guard was honest and was not a fix: it could not
 * survive the function being moved, and it pinned prose rather than behaviour.
 * Two implementations of "where does this heading start and end" is the class of
 * defect this repository keeps finding — the anchor engine, the fence scanner
 * and the scope walk have each been written twice, and each time both suites
 * were green because each asserted its own copy.
 *
 * The primitives this builds on — {@link splitLines}, {@link fencedCodeRanges},
 * {@link overlapsRange} — already live here and were already imported by both
 * sides, so the dependency edge this needs is one the repository had already
 * drawn. The module stays I/O-free and dependency-free like `./code.ts`:
 * strings in, offsets out, no zod, no Hono, nothing awkward in a browser bundle.
 *
 * The rule is CommonMark's ATX subset the rest of the codebase already applies:
 * up to three leading spaces, then one to six `#`, then whitespace and a name; a
 * closing sequence (`## Rates ##`) is decoration; four spaces of indent make it
 * an indented code block, not a heading; setext underlines are not headings.
 *
 * Offsets are UTF-16 code-unit offsets and ranges are half-open `[start, end)`,
 * as everywhere else in this package.
 */

import { fencedCodeRanges, overlapsRange, splitLines } from "./code.js";
import { HEADING_PATH_SEPARATOR } from "./schemas/retrieval.js";

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
 *
 * Including the heading's own line is deliberate, and both readers depend on it:
 * it is what makes an otherwise duplicated passage unique enough to quote back
 * on a `POST /api/docs/{id}/patch`, and it makes "replace this section" a single
 * patch.
 */
export interface HeadingSection {
  /** Enclosing heading names, outermost first; empty above the first heading. */
  readonly headings: readonly string[];
  /** `#` count of this section's own heading, and `0` for the leading section. */
  readonly level: number;
  /** Offset of this section's own heading line, or `0` for the leading section. */
  readonly start: number;
  readonly end: number;
}

/**
 * Every section of `text`, in document order, contiguous and covering it.
 *
 * The first section is the text above the first heading — the preamble — and
 * carries no headings at all; it is present even when empty so a caller can
 * treat the list as a partition. A caller that wants only the readable sections
 * filters the blank one out; it is the only section that can ever be blank,
 * since every other holds at least its own heading line.
 *
 * A heading a passage sits *on* encloses it, which is what makes a query that
 * hit a heading address that heading's own section.
 */
export function headingSections(text: string): HeadingSection[] {
  const fenced = fencedCodeRanges(text);
  const sections: HeadingSection[] = [];
  const stack: { readonly level: number; readonly text: string }[] = [];
  let start = 0;
  let level = 0;
  let headings: readonly string[] = [];

  for (const line of splitLines(text)) {
    const match = ATX_HEADING.exec(line.text);
    if (match === null) continue;
    // A `## Rates` inside a fenced block is prose, for every reader of this
    // scan — they all read the same mask.
    if (overlapsRange(fenced, line.start, line.contentEnd)) continue;

    sections.push({ headings, level, start, end: line.start });
    level = (match[1] ?? "").length;
    while ((stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    stack.push({ level, text: headingText(match[2]) });
    // An empty heading (`##` with nothing after it) closes its level without
    // naming one, so it is dropped from the path rather than joined as "".
    headings = stack.map((heading) => heading.text).filter((heading) => heading !== "");
    start = line.start;
  }
  sections.push({ headings, level, start, end: text.length });
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

/**
 * A section's address as a client prints it: enclosing headings outermost first,
 * and the document's **title** when a passage has none above it, so every
 * section has an address.
 *
 * A **display join**: callers print a path and never split one, because a
 * heading may legitimately contain the separator. That is why matching an
 * address is string equality against the whole rendered path rather than a
 * comparison of parsed segments — and it is why this lives beside the scan
 * instead of being restated by each surface that prints one.
 */
export const renderHeadingPath = (headings: readonly string[], title: string): string =>
  headings.length === 0 ? title : headings.join(HEADING_PATH_SEPARATOR);
