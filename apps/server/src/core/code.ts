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
 * before: both widths are zero and the regex is applied to the line as given.
 *
 * Indentation is measured in **columns**, not characters — see expandTabs.
 *
 * What stays approximate, and is accepted as such (full container parsing is a
 * markdown parser, which this module deliberately is not). Each entry names the
 * direction it errs in, because the two directions are not equally bad: a *miss*
 * is silent and leaves the bytes reading as they read today, while a *false
 * error* fails `corpus doc check` on valid CommonMark and — since the same scan
 * feeds fencedCodeRanges — hides everything after the supposed fence.
 *
 * - **Containers never end.** A fence opened inside a list item stays open past
 *   the end of that item; CommonMark closes it at the item's boundary, so
 *   `"- ```js\n  code\n\nAfter.\n"` is a *closed* fence there and an unterminated
 *   one here. Direction: **false error** — and, with it, masking that runs to the
 *   end of the text. What keeps that honest rather than merely wrong is that
 *   fencedCodeRanges and unterminatedFence err *together*: the report describes
 *   what the corpus's own readers will really do with those bytes instead of
 *   contradicting them. Closing a container needs the block structure this
 *   module declines to build.
 * - **A list marker is a container wherever it appears.** CommonMark lets an
 *   ordered item interrupt a paragraph only when it starts at 1, so in
 *   `"Some prose\n2. ```\nmore text\n"` there is no list and no fence at all,
 *   while this scanner reads a container fence that never closes. Direction:
 *   **false error**, and narrow — it needs an ordered marker numbered other than
 *   1, immediately after a paragraph line, opening a run that never closes. It
 *   is left alone because the obvious repair is wrong: `"1. a\n2. ```js\n   code\n   ```\n"`
 *   is a *sibling item*, a genuine container, and refusing it there would make
 *   the item's closing fence read as a fresh opener — finding A's failure exactly.
 *   Telling the two apart is paragraph tracking, i.e. a parser.
 * - **HTML blocks are not modelled.** A line inside a raw HTML block that reads
 *   as a fence is a fence to this scanner and is raw text to CommonMark.
 *   Direction: **false error** if such a block holds an odd number of them,
 *   otherwise mis-placed masking with no report.
 * - **Setext underlines and link reference definitions** are not modelled
 *   either, and cannot err in either direction: neither construct can contain a
 *   line that reads as a fence, nor terminate one.
 */

/** Up to three spaces, `>`, and the one optional space that belongs to the marker. */
const BLOCKQUOTE_MARKER = /^ {0,3}> ?/;

/** Up to three spaces, a bullet or ordered marker, and the spaces that follow it. */
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])( *)/;

/** CommonMark advances a tab to the next multiple of four columns. */
const TAB_STOP = 4;

/**
 * A line with every tab replaced by the spaces it stands for, so that a
 * character offset into the result *is* a CommonMark column.
 *
 * Indentation is the one thing this scanner measures, and CommonMark measures it
 * in columns: `"\t```"` under a bullet whose content column is 2 is a closer with
 * two columns of relative indent, and a fence it closes. Expanding once, here, is
 * what lets the opener's `FENCE_LINE` test and the continuation allowance below
 * both be written in spaces and still mean columns — neither can disagree with
 * the other about a tab because neither ever sees one. (Doing it in only one of
 * the two places is how a bulleted fence came to be opened and never closed:
 * SERVER-066 review round 2.)
 *
 * A line holding no tab is returned unchanged, which is what keeps a tab-free
 * text on exactly the path it took before containers were modelled at all.
 *
 * Columns are counted in UTF-16 code units, so a tab following an astral
 * character lands one column late. Nothing decided here depends on that: every
 * measurement is of the whitespace and container markers *preceding* a delimiter
 * run, and that region is ASCII by construction.
 */
const expandTabs = (text: string): string => {
  if (!text.includes("\t")) return text;
  let expanded = "";
  for (const char of text) {
    expanded += char === "\t" ? " ".repeat(TAB_STOP - (expanded.length % TAB_STOP)) : char;
  }
  return expanded;
};

/** Columns of leading indentation. Lines reach this tab-expanded, so a space is a column. */
const leadingIndent = (text: string): number => /^ */.exec(text)?.[0].length ?? 0;

/**
 * Content column of the container prefix an opening fence line may sit behind,
 * and how many block quotes it entered. `text` is tab-expanded, so the returned
 * width is a column.
 *
 * A list marker counts only when content follows it on the same line — that is
 * the only case a fence can be in. CommonMark puts the item's content column one
 * space after the marker when five or more columns of whitespace follow (the
 * rest is the content's own indentation, which `FENCE_LINE` then judges), and
 * directly after the run of one to four otherwise. Because the line arrives
 * expanded, `"-\t```js"` is `"-   ```js"` here: three columns of whitespace, and
 * a content column of 4, which is what CommonMark gives it.
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
 * Columns of container continuation to remove from a line while `open`'s fence
 * is open: its block quotes' markers, then whatever the containers' content
 * column contributes that this line spells as plain indentation.
 *
 * The two are interleaved rather than sequenced, mirroring the opener's walk,
 * because a block quote can itself sit inside an indented container: in
 * `"  - > ```"` the marker of the continuation line `"    > code"` is preceded by
 * four columns belonging to the list item, which is more than the three
 * `BLOCKQUOTE_MARKER` tolerates on its own. Spending the item's allowance first
 * is what lets that marker be found.
 */
const containerContinuationWidth = (
  text: string,
  open: { readonly column: number; readonly quoteDepth: number },
): number => {
  let width = 0;
  const spend = (from: number): number =>
    Math.min(Math.max(0, open.column - from), leadingIndent(text.slice(from)));
  for (let depth = 0; depth < open.quoteDepth; depth += 1) {
    const indent = spend(width);
    const quote = BLOCKQUOTE_MARKER.exec(text.slice(width + indent));
    if (quote === null) break;
    width += indent + quote[0].length;
  }
  return width + spend(width);
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
    // The one place a tab becomes a column; everything below measures in spaces.
    const lineText = expandTabs(line.text);
    if (open === null) {
      const prefix = containerOpenPrefix(lineText);
      const match = FENCE_LINE.exec(lineText.slice(prefix.width));
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
    const match = FENCE_LINE.exec(lineText.slice(containerContinuationWidth(lineText, open)));
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
