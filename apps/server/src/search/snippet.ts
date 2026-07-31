import { SNIPPET_CLOSE, SNIPPET_OPEN } from "../docs/index.js";

/**
 * A `snippet()` result, unmarked: the plain text FTS5 returned, plus where each
 * matched term begins inside it.
 *
 * The offsets tell a matched column from one FTS5 merely previewed, which is
 * what decides whether a hit's line of context comes from its body or its
 * title.
 */
export interface UnmarkedSnippet {
  readonly text: string;
  /** Offsets of the delimited terms within {@link text}, in order. */
  readonly matchOffsets: readonly number[];
}

/** Whether this column matched at all — how a column FTS5 merely previewed is told apart. */
export const hasMatch = (snippet: UnmarkedSnippet): boolean => snippet.matchOffsets.length > 0;

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
