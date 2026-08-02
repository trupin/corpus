/**
 * One line of context, for the retrieval surface (SPEC.md §7 Retrieval
 * discipline, §9.2).
 *
 * Both retrieval endpoints answer with rows a client prints one per line — a
 * search hit's `snippet` and a related row's `excerpt` — and the contract says
 * so in both places ("a single line — no newline", "collapsed to one line so a
 * client prints one row per line"). The rule is written once here because the
 * two endpoints must shape their line identically: the agent reads them in the
 * same list-shaped output and a stray newline corrupts the same parse.
 *
 * Two transformations, in this order:
 *
 * - **Collapse.** Every run of whitespace — newlines included — becomes a
 *   single space, and the result is trimmed. This is what makes the string a
 *   line rather than a slice that happens to be short.
 * - **Bound.** The result is truncated to {@link ONE_LINE_MAX_CHARS}, at a word
 *   boundary when one is near the cut, with a single-character ellipsis marking
 *   the truncation. A bound is required because neither source is intrinsically
 *   short in characters: FTS5's `snippet()` counts *tokens*, and a single token
 *   can be a base64 blob. The ellipsis is spent *from* the bound, never added to
 *   it — the returned string is never longer than `maxChars`, for any input.
 *
 * Deliberately not a markdown stripper. `apps/server` has no markdown parser
 * and is not getting one (sprint-019 Adjudication 5); a heuristic that ate `**`
 * would also eat a document that is *about* asterisks. The line is a taste of
 * the text as written.
 */

/**
 * How long a retrieval line may be.
 *
 * Chosen against the two things that read it: an 80-column terminal row (the
 * CLI prints id, path and this on one line) and an agent that pays per token.
 * 160 characters is roughly two terminal lines of prose at worst and ~40 tokens
 * — enough to recognise a passage, never enough to read it. The rejected
 * alternative was the projection's `EXCERPT_LENGTH` of 280: that number sizes a
 * *list row's* multi-line preview, and reusing it here would put a paragraph in
 * a surface whose entire justification is that it does not return paragraphs.
 */
export const ONE_LINE_MAX_CHARS = 160;

/** U+2026, the same single character `snippet()` is given for its own elisions. */
export const ONE_LINE_ELLIPSIS = "…";

/**
 * How far back a word-boundary cut may reach, as a fraction of the bound:
 * nearer than this and truncating mid-word loses less than the missing words.
 */
const WORD_BREAK_FLOOR = 0.75;

const WHITESPACE_RUN = /\s+/gu;

/**
 * Collapse `text` to a single trimmed line, never longer than `maxChars`.
 *
 * `maxChars` is a hard ceiling, not a budget for the text alone: callers publish
 * it as a schema bound (`ContextExcerptSchema.excerpt` is `.max(320)`), so a
 * line that spent the whole budget on characters and then grew an ellipsis
 * would violate the contract it is measured against. The marker is therefore
 * charged against the bound — which only bites on the no-word-break path, since
 * a word-boundary cut has already given back at least the space it broke on.
 */
export function toOneLine(text: string, maxChars: number = ONE_LINE_MAX_CHARS): string {
  const line = text.replace(WHITESPACE_RUN, " ").trim();
  if (line.length <= maxChars) return line;

  const budget = maxChars - ONE_LINE_ELLIPSIS.length;
  if (budget < 0) return "";

  const cut = line.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const end = lastSpace >= maxChars * WORD_BREAK_FLOOR ? lastSpace : budget;
  return `${cut.slice(0, Math.min(end, budget)).trimEnd()}${ONE_LINE_ELLIPSIS}`;
}
