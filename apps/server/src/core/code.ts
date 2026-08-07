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

/*
 * How much of a container block this scanner models, and why it models any.
 *
 * A fence does not have to start at the left margin: CommonMark lets one open
 * inside a list item or a block quote, where the delimiter run is preceded by
 * the container's marker. FENCE_LINE alone cannot see those, and the failure is
 * not a benign miss — it misses the *opener* and then reads the indented
 * *closer* as a fresh opener. So a bullet whose item is a code block (the marker
 * and the opening run on one line, the body and the closing run indented under
 * it) masked from its closing line to the end of the document, and, since
 * SERVER-066 made that an **error**, failed `corpus doc check` on valid
 * CommonMark (SERVER-066 review, finding A). A false error on correct content is
 * worse than the silence it replaced.
 *
 * The line drawn, deliberately narrow: a fence's **opening** line may sit behind
 * a run of block-quote markers and list-item markers, and the fence remembers
 * the block-quote depth and the content column it opened behind. While that
 * fence is open, each line has exactly that many block-quote markers and up to
 * that much indentation removed before the closing rule is applied — nothing
 * more. In particular a *new* list marker is never stripped from a line inside
 * an open fence: inside a fence there are no new containers, only continuations
 * of the ones already entered, and stripping one would let a line of code that
 * happens to read as a bulleted fence close the block it belongs to.
 *
 * A text with no container markers therefore takes exactly the path it took
 * before: both widths are zero and the regex is applied to the raw line.
 *
 * What stays approximate, and is accepted as such (full container parsing is a
 * markdown parser, which this module deliberately is not):
 *
 * - **Containers never end.** A fence opened inside a list item stays open past
 *   the end of that item; CommonMark would close it at the item's boundary. The
 *   scanner errs toward "still inside code", and — the property that matters —
 *   fencedCodeRanges and unterminatedFence err *together*, so the report always
 *   describes what the corpus's own readers will really do with the bytes rather
 *   than contradicting them.
 * - **Tabs are not expanded.** A container marker followed by a tab is not seen.
 * - **Setext underlines, link reference definitions and HTML blocks** are not
 *   modelled at all; none of them can contain or terminate a fence.
 */

/** Up to three spaces, `>`, and the one optional space that belongs to the marker. */
const BLOCKQUOTE_MARKER = /^ {0,3}> ?/;

/** Up to three spaces, a bullet or ordered marker, and the spaces that follow it. */
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])( *)/;

/** Leading spaces of a line, as a count. */
const leadingSpaces = (text: string): number => /^ */.exec(text)?.[0].length ?? 0;

/**
 * Width of the container prefix an opening fence line may sit behind, and how
 * many block quotes it entered.
 *
 * A list marker counts only when content follows it on the same line — that is
 * the only case a fence can be in. CommonMark puts the item's content column one
 * space after the marker when five or more spaces follow (the rest is the
 * content's own indentation, which `FENCE_LINE` then judges), and directly after
 * the run of one to four spaces otherwise.
 */
const containerOpenPrefix = (text: string): { width: number; quoteDepth: number } => {
  let width = 0;
  let quoteDepth = 0;
  for (;;) {
    const rest = text.slice(width);
    const quote = BLOCKQUOTE_MARKER.exec(rest);
    if (quote !== null) {
      width += quote[0].length;
      quoteDepth += 1;
      continue;
    }
    const list = LIST_MARKER.exec(rest);
    const spaces = list?.[1]?.length ?? 0;
    if (list === null || spaces === 0) break;
    width += list[0].length - spaces + (spaces >= 5 ? 1 : spaces);
  }
  return { width, quoteDepth };
};

/**
 * Width of the container continuation to remove from a line while `open`'s fence
 * is open: its block quotes' markers, then whatever the containers' content
 * column contributes that this line spells as plain indentation.
 */
const containerContinuationWidth = (
  text: string,
  open: { readonly column: number; readonly quoteDepth: number },
): number => {
  let width = 0;
  for (let depth = 0; depth < open.quoteDepth; depth += 1) {
    const quote = BLOCKQUOTE_MARKER.exec(text.slice(width));
    if (quote === null) break;
    width += quote[0].length;
  }
  const allowance = Math.max(0, open.column - width);
  return width + Math.min(allowance, leadingSpaces(text.slice(width)));
};

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
  /** The open fence plus the container state the closing rule needs. */
  let open: (OpenFence & { readonly column: number; readonly quoteDepth: number }) | null = null;
  let lineNumber = 0;
  for (const line of splitLines(text)) {
    lineNumber += 1;
    if (open === null) {
      const prefix = containerOpenPrefix(line.text);
      const match = FENCE_LINE.exec(line.text.slice(prefix.width));
      if (match === null) continue;
      const marker = match[1] ?? "";
      // An info string may not contain a backtick when the fence is backticks.
      if (marker.startsWith("`") && (match[2] ?? "").includes("`")) continue;
      open = {
        marker,
        start: line.start,
        line: lineNumber,
        column: prefix.width,
        quoteDepth: prefix.quoteDepth,
      };
      continue;
    }
    const match = FENCE_LINE.exec(line.text.slice(containerContinuationWidth(line.text, open)));
    const marker = match?.[1] ?? "";
    const closes =
      match !== null &&
      (match[2] ?? "").trim() === "" &&
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length;
    if (closes) {
      ranges.push({ start: open.start, end: line.contentEnd });
      open = null;
    }
  }
  return {
    ranges,
    open: open === null ? null : { marker: open.marker, start: open.start, line: open.line },
  };
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
