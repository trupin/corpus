/**
 * Deterministic chunking with content-addressed identity (SPEC.md §9.1,
 * "Deterministic chunking, content-addressed identity").
 *
 * A body is split along its markdown heading structure: one chunk per section,
 * split further when a section runs past a bounded size budget. A chunk's id is
 * a hash of exactly three things — the document's id, the chunk's heading path,
 * and the chunk's text — so the same content always yields the same chunks, and
 * a chunk that survives an edit keeps its id and therefore whatever the semantic
 * index has already computed for it.
 *
 * Everything here is pure: no clock, no counter, no filesystem, no row id, no
 * path. The observable consequence the spec asks for — "re-indexing is
 * proportional to the edit" — is entirely a property of that purity plus the
 * heading-and-content addressing, so this module has no dependency on the
 * projection at all.
 */

import { createHash } from "node:crypto";
import {
  HEADING_PATH_SEPARATOR,
  fencedCodeRanges,
  overlapsRange,
  splitLines,
  type Line,
  type TextRange,
} from "@corpus/contract";
import { headingSections } from "../core/headings.js";

/**
 * The size budget a section is split at, in **characters**.
 *
 * SPEC.md §9.1 states the budget in tokens ("~500 tokens"); this
 * implementation approximates it by characters, because tokenizing here would
 * mean shipping a tokenizer whose vocabulary must then match whichever
 * embedding model the workspace resolved (§9.1's provider is not fixed) — and a
 * chunk boundary that moved when the model changed would re-address every chunk
 * of every document, which is precisely what content addressing exists to
 * prevent. So the budget is char-denominated and model-independent:
 *
 * - {@link CHUNK_TOKEN_BUDGET} — the spec's number, 500 tokens.
 * - {@link CHUNK_CHARS_PER_TOKEN} — 4 characters per token, the conventional
 *   English-prose ratio for byte-pair vocabularies (GPT/BERT-family tokenizers
 *   average 3.5–4.5 characters per token on prose; markdown, with more
 *   punctuation, sits at the lower end, so 4 is a mild over-estimate of chunk
 *   size and therefore a mild under-fill of the budget — the safe direction).
 * - {@link CHUNK_CHAR_BUDGET} — their product, 2000 characters.
 *
 * The budget is a *ceiling for splitting*, not a target: a section shorter than
 * it is one chunk however short, because a section is the unit a heading path
 * addresses and merging two sections would make the address a lie.
 */
export const CHUNK_TOKEN_BUDGET = 500;

/** Characters per token assumed by {@link CHUNK_CHAR_BUDGET}; see its doc comment. */
export const CHUNK_CHARS_PER_TOKEN = 4;

/** {@link CHUNK_TOKEN_BUDGET} × {@link CHUNK_CHARS_PER_TOKEN} = 2000 characters. */
export const CHUNK_CHAR_BUDGET = CHUNK_TOKEN_BUDGET * CHUNK_CHARS_PER_TOKEN;

/** How many hex characters of the digest a chunk id carries — 128 bits. */
const CHUNK_ID_HEX_LENGTH = 32;

export interface Chunk {
  /** `hash(document id, heading path, content)` — see {@link chunkId}. */
  readonly id: string;
  /** Position within the body being chunked, ascending from zero. */
  readonly ord: number;
  /** The chunk's address: enclosing heading names, outermost first. */
  readonly headings: readonly string[];
  /** {@link headings} rendered for display, with §9.2's document-title floor. */
  readonly headingPath: string;
  /** Half-open `[start, end)` offsets into the body this chunk was cut from. */
  readonly start: number;
  readonly end: number;
  /** The chunk's text, verbatim — `body.slice(start, end)`. */
  readonly text: string;
}

export interface ChunkSource {
  /** The document the body belongs to (§5: ids are identity, paths are not). */
  readonly docId: string;
  /**
   * Displayed when a chunk has no heading above it — §9.2's floor, so every
   * chunk has an address. Deliberately **not** part of {@link chunkId}: a
   * retitled document is not re-chunked.
   */
  readonly title: string;
  /**
   * Prepended to every chunk's heading list. A thread turn's chunks live under
   * the turn's own `author · ts` heading (§6), which is not part of the turn's
   * body text and so cannot be scanned out of it.
   */
  readonly rootHeading?: string;
}

/**
 * A chunk's identity: `sha256(document id, heading path, content)`, truncated to
 * 128 bits.
 *
 * Exactly three inputs, encoded through `JSON.stringify` so the encoding is
 * injective — a heading containing the separator, or a body containing the
 * delimiter, cannot forge another chunk's id. The path is the heading *list*,
 * not its rendered form, so the display floor (the document title) never
 * reaches the hash.
 *
 * Two chunks of one document with the same heading path and byte-identical text
 * share an id. That is correct rather than a collision: they have the same
 * content under the same address, so they have the same semantic
 * representation, and the index stores it once.
 */
export function chunkId(docId: string, headings: readonly string[], text: string): string {
  return createHash("sha256")
    .update(JSON.stringify([docId, headings, text]))
    .digest("hex")
    .slice(0, CHUNK_ID_HEX_LENGTH);
}

/** The chunk address as a client prints it — a display join, never split by a reader. */
export const renderHeadingPath = (headings: readonly string[], title: string): string =>
  headings.length === 0 ? title : headings.join(HEADING_PATH_SEPARATOR);

/**
 * Paragraph-ish units of `[start, end)`: a new unit begins at the first
 * non-blank line after a run of blank lines, outside fenced code.
 *
 * Units are contiguous and cover the range, so packing them can never lose or
 * duplicate a character. A fenced block is one unit however many blank lines it
 * contains — splitting inside a fence would hand the index half a code block.
 */
function paragraphUnits(
  lines: readonly Line[],
  fenced: readonly TextRange[],
  start: number,
  end: number,
): TextRange[] {
  const units: TextRange[] = [];
  let unitStart = start;
  let previousBlank = false;
  for (const line of lines) {
    if (line.start < start || line.start >= end) continue;
    const inFence = overlapsRange(fenced, line.start, Math.max(line.contentEnd, line.start + 1));
    const blank = !inFence && line.text.trim() === "";
    if (!blank && previousBlank && line.start > unitStart) {
      units.push({ start: unitStart, end: line.start });
      unitStart = line.start;
    }
    previousBlank = blank;
  }
  if (unitStart < end) units.push({ start: unitStart, end });
  return units;
}

/** Line-granularity units of `[start, end)`, for a paragraph that is itself oversized. */
function lineUnits(lines: readonly Line[], start: number, end: number): TextRange[] {
  const units = lines
    .filter((line) => line.start >= start && line.start < end)
    .map((line) => ({ start: line.start, end: Math.min(line.end, end) }));
  return units.length === 0 ? [{ start, end }] : units;
}

/** Greedy left-to-right packing: a unit joins the current run while it fits. */
function pack(units: readonly TextRange[]): TextRange[] {
  const packed: TextRange[] = [];
  let open: TextRange | null = null;
  for (const unit of units) {
    if (open === null) {
      open = unit;
    } else if (unit.end - open.start <= CHUNK_CHAR_BUDGET) {
      open = { start: open.start, end: unit.end };
    } else {
      packed.push(open);
      open = unit;
    }
  }
  if (open !== null) packed.push(open);
  return packed;
}

/** Last resort for a single line past the budget: cut it at the budget. */
function hardSplit(range: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  for (let at = range.start; at < range.end; at += CHUNK_CHAR_BUDGET) {
    ranges.push({ start: at, end: Math.min(at + CHUNK_CHAR_BUDGET, range.end) });
  }
  return ranges.length === 0 ? [range] : ranges;
}

/**
 * Ranges one section splits into: whole while it fits the budget, then by
 * paragraph, then by line, then — only for a single line longer than the budget
 * — at the budget itself.
 *
 * Greedy and left-to-right at every level, which is what makes sub-addressing
 * stable: appending to the end of an oversized section leaves every earlier
 * sub-chunk's bytes, and therefore its id, exactly as they were.
 */
function splitSection(
  lines: readonly Line[],
  fenced: readonly TextRange[],
  section: TextRange,
): TextRange[] {
  if (section.end - section.start <= CHUNK_CHAR_BUDGET) return [section];
  return pack(paragraphUnits(lines, fenced, section.start, section.end)).flatMap((paragraph) =>
    paragraph.end - paragraph.start <= CHUNK_CHAR_BUDGET
      ? [paragraph]
      : pack(lineUnits(lines, paragraph.start, paragraph.end)).flatMap((line) =>
          line.end - line.start <= CHUNK_CHAR_BUDGET ? [line] : hardSplit(line),
        ),
  );
}

/**
 * Split `body` into chunks. Pure — the same body and source always produce the
 * same chunks, in the same order, with the same ids.
 *
 * Blank sections contribute nothing: a body that opens straight onto a heading
 * has an empty preamble, and a document with an empty body has no chunks at
 * all. Everything else produces at least one chunk, and a body with no ATX
 * heading anywhere produces exactly one whose address falls back to the
 * document's title.
 */
export function chunkBody(body: string, source: ChunkSource): Chunk[] {
  const fenced = fencedCodeRanges(body);
  const lines = splitLines(body);
  const root = source.rootHeading === undefined ? [] : [source.rootHeading];
  const chunks: Chunk[] = [];

  for (const section of headingSections(body)) {
    const headings = [...root, ...section.headings];
    for (const range of splitSection(lines, fenced, section)) {
      const text = body.slice(range.start, range.end);
      if (text.trim() === "") continue;
      chunks.push({
        id: chunkId(source.docId, headings, text),
        ord: chunks.length,
        headings,
        headingPath: renderHeadingPath(headings, source.title),
        start: range.start,
        end: range.end,
        text,
      });
    }
  }
  return chunks;
}
