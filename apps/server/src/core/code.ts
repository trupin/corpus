/**
 * Code-region detection for markdown bodies.
 *
 * Two features of the on-disk format read the body with a scanner rather than a
 * markdown parser: inline `[[refs]]` (§5) and the `## author · ts` turn headings
 * that delimit thread turns (§6). Both must ignore anything inside code, so a
 * documented snippet can quote a ref or a heading without changing meaning.
 * Keeping that one rule here means the two scanners can never disagree about
 * what "inside code" means.
 *
 * Offsets are UTF-16 code-unit offsets — the same units `String.prototype.slice`
 * uses — and every range is half-open `[start, end)`.
 */

export type TextRange = { readonly start: number; readonly end: number };

/** Up to three leading spaces still opens a fence; four makes it an indented code block. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export type Line = {
  /** The line's text, without its terminator. */
  readonly text: string;
  readonly start: number;
  /** Offset of the line terminator, i.e. the end of {@link text}. */
  readonly contentEnd: number;
  /** Offset just past the line terminator — where the next line begins. */
  readonly end: number;
};

/** Split into lines, tolerating both LF and CRLF, and report each line's offsets. */
export const splitLines = (text: string): Line[] => {
  const lines: Line[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) {
      lines.push({ text: text.slice(start), start, contentEnd: text.length, end: text.length });
      break;
    }
    const withoutCr = text[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({
      text: text.slice(start, withoutCr),
      start,
      contentEnd: newline,
      end: newline + 1,
    });
    start = newline + 1;
  }
  return lines;
};

/**
 * Ranges covered by fenced code blocks, fence lines included. An unterminated
 * fence runs to the end of the text, matching CommonMark.
 */
export const fencedCodeRanges = (text: string): TextRange[] => {
  const ranges: TextRange[] = [];
  let open: { marker: string; start: number } | null = null;
  for (const line of splitLines(text)) {
    const match = FENCE_LINE.exec(line.text);
    const marker = match?.[1] ?? "";
    const info = match?.[2] ?? "";
    if (open === null) {
      if (match === null) continue;
      // An info string may not contain a backtick when the fence is backticks.
      if (marker.startsWith("`") && info.includes("`")) continue;
      open = { marker, start: line.start };
      continue;
    }
    const closes =
      match !== null &&
      info.trim() === "" &&
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length;
    if (closes) {
      ranges.push({ start: open.start, end: line.contentEnd });
      open = null;
    }
  }
  if (open !== null) ranges.push({ start: open.start, end: text.length });
  return ranges;
};

const isMasked = (ranges: readonly TextRange[], offset: number): boolean =>
  ranges.some((range) => offset >= range.start && offset < range.end);

/**
 * Ranges covered by inline code spans, delimiting backticks included. Follows
 * CommonMark: a run of N backticks opens a span that the next run of exactly N
 * backticks closes; an unmatched run is literal text.
 */
export const inlineCodeRanges = (text: string, skip: readonly TextRange[] = []): TextRange[] => {
  const ranges: TextRange[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`" || isMasked(skip, index)) {
      index += 1;
      continue;
    }
    const openStart = index;
    while (text[index] === "`") index += 1;
    const runLength = index - openStart;
    let cursor = index;
    let closeStart = -1;
    while (cursor < text.length) {
      if (text[cursor] !== "`" || isMasked(skip, cursor)) {
        cursor += 1;
        continue;
      }
      const candidateStart = cursor;
      while (text[cursor] === "`") cursor += 1;
      if (cursor - candidateStart === runLength) {
        closeStart = candidateStart;
        break;
      }
    }
    if (closeStart === -1) continue;
    ranges.push({ start: openStart, end: closeStart + runLength });
    index = closeStart + runLength;
  }
  return ranges;
};

/** Every range a body scanner must treat as opaque: fenced blocks plus inline spans. */
export const codeRanges = (text: string): TextRange[] => {
  const fenced = fencedCodeRanges(text);
  return [...fenced, ...inlineCodeRanges(text, fenced)];
};

/** True when any part of `[start, end)` falls inside one of `ranges`. */
export const overlapsRange = (ranges: readonly TextRange[], start: number, end: number): boolean =>
  ranges.some((range) => start < range.end && end > range.start);
