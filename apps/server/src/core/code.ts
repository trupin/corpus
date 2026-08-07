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

/** A fence that opened and was never closed — what {@link unterminatedFence} reports. */
export type OpenFence = {
  /**
   * The delimiter run the fence opened with, e.g. `` "```" `` or `"~~~~"`. A
   * closing line must repeat this character at least this many times, so
   * reporting it is reporting what the fix has to look like.
   */
  readonly marker: string;
  /** Offset of the start of the opening fence line. */
  readonly start: number;
  /** 1-based line number of the opening fence line within the scanned text. */
  readonly line: number;
};

/**
 * The one fence scanner. It answers both questions the module is asked — which
 * ranges are code, and whether a fence was left open — from a single pass, so
 * "is this inside code" and "where did the unclosed fence open" can never be
 * decided by two grammars that drift apart.
 *
 * `ranges` holds only the fences that *closed*; the still-open one, if any, is
 * returned separately because the two readers want opposite things from it.
 */
const scanFences = (text: string): { ranges: TextRange[]; open: OpenFence | null } => {
  const ranges: TextRange[] = [];
  let open: OpenFence | null = null;
  let lineNumber = 0;
  for (const line of splitLines(text)) {
    lineNumber += 1;
    const match = FENCE_LINE.exec(line.text);
    const marker = match?.[1] ?? "";
    const info = match?.[2] ?? "";
    if (open === null) {
      if (match === null) continue;
      // An info string may not contain a backtick when the fence is backticks.
      if (marker.startsWith("`") && info.includes("`")) continue;
      open = { marker, start: line.start, line: lineNumber };
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
  return { ranges, open };
};

/**
 * Ranges covered by fenced code blocks, fence lines included. An unterminated
 * fence runs to the end of the text, matching CommonMark.
 */
export const fencedCodeRanges = (text: string): TextRange[] => {
  const { ranges, open } = scanFences(text);
  if (open !== null) ranges.push({ start: open.start, end: text.length });
  return ranges;
};

/**
 * The fence this text left open, or `null` when every fence closed.
 *
 * {@link fencedCodeRanges} already *models* the state — it runs the range to the
 * end of the text, which is what CommonMark says — but a mask cannot say where
 * the mistake is. §14's validator needs the opening line, because the whole
 * reason to report an unclosed fence is that a person has to go and close it
 * (SERVER-066): everything after it reads as code, so the body's `[[refs]]` and
 * — in a thread — its `## author · timestamp` turn headings stop being seen.
 *
 * This deliberately does not judge whether that is a problem. It reports the
 * grammar; `core/check.ts` decides what a corpus makes of it.
 */
export const unterminatedFence = (text: string): OpenFence | null => scanFences(text).open;

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
