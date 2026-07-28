/**
 * Minimal markdown escaping.
 *
 * The printer this module plugs into (`mdast-util-to-markdown`, through
 * `remark-stringify`) escapes defensively: every `_`, every `*`, every `[`, in
 * every position. That is correct and it is also unusable here. `snake_case`
 * becomes `snake\_case`, `2 * 3` becomes `2 \* 3`, `[draft]` becomes
 * `\[draft]` — so the first time a user fixes a typo in paragraph nine, the
 * autosave rewrites punctuation in paragraphs one through eight. Sprint-011's
 * TEST-22 is exactly that: *"`git diff HEAD~1` shows ONLY that paragraph
 * changed. No reflowed lists, no re-escaped emphasis"*.
 *
 * So escaping is decided here, per character, from what the character could
 * actually start. The rules below are conservative — when in doubt they escape
 * — and they are **not trusted**: `serialize.ts` prints the document a second
 * time with the printer's own escaping and compares the two parses, falling
 * back to the defensive output whenever this module's answer would have changed
 * the meaning. A bug here therefore costs churn, never corruption.
 */

const WHITESPACE = /\s/;
const WORD = /[A-Za-z0-9]/;

function isSpaceOrEdge(character: string): boolean {
  return character === "" || WHITESPACE.test(character);
}

/**
 * The one construct a *line* can start that its characters alone do not
 * announce. Returns the index of the character to escape, or `-1`.
 *
 * CommonMark allows up to three leading spaces before a block marker, which is
 * why the patterns tolerate them rather than anchoring hard at column zero.
 */
export function leadingMarkerIndex(line: string): number {
  const indent = /^ {0,3}/.exec(line)?.[0].length ?? 0;
  const rest = line.slice(indent);
  if (rest === "") return -1;

  // ATX heading: `#` … `######` followed by a space or end of line.
  if (/^#{1,6}(\s|$)/.test(rest)) return indent;
  // Bullet list marker.
  if (/^[-+*](\s|$)/.test(rest)) return indent;
  // Block quote.
  if (rest.startsWith(">")) return indent;
  // Fenced code.
  if (/^(`{3,}|~{3,})/.test(rest)) return indent;
  // Thematic break — three or more of the same marker, spaces allowed between.
  if (/^(\*[ \t]*){3,}$|^(-[ \t]*){3,}$|^(_[ \t]*){3,}$/.test(rest)) return indent;
  // Setext underline. `-` runs are already caught above; `=` runs are not.
  if (/^=+[ \t]*$/.test(rest)) return indent;
  // Ordered list marker: escape the delimiter, not the digits.
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(rest);
  if (ordered !== null) return indent + (ordered[1]?.length ?? 0);
  return -1;
}

/** Whether `[` at `index` opens something that would parse as a link or footnote. */
function opensReference(line: string, index: number): boolean {
  const rest = line.slice(index);
  if (rest.startsWith("[^")) return true;
  // `[text](…)` and `[text][ref]`. A bare `[text]` with no definition is
  // literal text in CommonMark, and escaping it is the churn this avoids.
  return /^\[[^\]\n]*\]\s*[([]/.test(rest);
}

interface LineContext {
  /** The line begins a block line, so a leading marker would be read as one. */
  readonly atLineStart: boolean;
  /** Character immediately before the line's first character, `""` at the edge. */
  readonly before: string;
  /** Character immediately after the line's last character, `""` at the edge. */
  readonly after: string;
}

function escapeLine(line: string, context: LineContext): string {
  const marker = context.atLineStart ? leadingMarkerIndex(line) : -1;
  let out = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    const previous = index === 0 ? context.before : (line[index - 1] ?? "");
    const next = index === line.length - 1 ? context.after : (line[index + 1] ?? "");
    if (index === marker || needsEscape(character, previous, next, line, index)) out += "\\";
    out += character;
  }
  return out;
}

function needsEscape(
  character: string,
  previous: string,
  next: string,
  line: string,
  index: number,
): boolean {
  switch (character) {
    // A backslash is the escape mechanism itself: an unescaped one would eat
    // the character after it on the way back in.
    case "\\":
      return true;
    // A backtick opens a code span from anywhere. Rare in prose, and the cost
    // of being wrong is losing a run of text into a code span.
    case "`":
      return true;
    // Emphasis delimiters can only flank; one surrounded by whitespace can
    // neither open nor close, which is what makes `2 * 3` safe.
    case "*":
      return !(isSpaceOrEdge(previous) && isSpaceOrEdge(next));
    // `_` additionally cannot delimit intraword — CommonMark's rule, and the
    // reason `snake_case` stays as written.
    case "_":
      if (WORD.test(previous) && WORD.test(next)) return false;
      return !(isSpaceOrEdge(previous) && isSpaceOrEdge(next));
    // GFM strikethrough needs a pair.
    case "~":
      return next === "~" || previous === "~";
    // An autolink or an HTML tag.
    case "<":
      return /[A-Za-z/!?]/.test(next);
    // A character reference; anything else is a literal ampersand.
    case "&":
      return /[A-Za-z0-9#]/.test(next);
    case "[":
      return opensReference(line, index);
    default:
      return false;
  }
}

export interface EscapeContext {
  /** Text already emitted before this value; its tail decides flanking. */
  readonly before: string;
  /** Text that will follow this value. */
  readonly after: string;
}

/**
 * Escapes one text value for insertion into markdown phrasing content.
 *
 * A value may span several lines (a soft break inside a paragraph is a `\n` in
 * the text node), and every line after the first begins a block line — so the
 * leading-marker rules apply to each of them.
 */
export function escapeMarkdownText(value: string, context: EscapeContext): string {
  if (value === "") return "";
  const lines = value.split("\n");
  const openerIsLineStart = context.before === "" || context.before.endsWith("\n");
  return lines
    .map((line, index) =>
      escapeLine(line, {
        atLineStart: index > 0 || openerIsLineStart,
        before: index === 0 ? context.before.slice(-1) : "",
        after: index === lines.length - 1 ? context.after.slice(0, 1) : "",
      }),
    )
    .join("\n");
}
