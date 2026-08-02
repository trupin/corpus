import { Fragment, type ReactElement } from "react";

/**
 * A result's one line of context, with the query's words marked.
 *
 * **The marking is the client's now.** `GET /api/docs` answered with structured
 * `{text, match}` runs; `GET /api/search` answers with `snippet: string` — "one
 * line of context around the match, in plain text: … none of the delimiters the
 * full-text index marks matches with". Ranked retrieval is read by an agent that
 * pays for every character, so the runs are deliberately not on that wire.
 *
 * SPEC.md §11 still asks for **snippet-highlighted results**, and the Phase C
 * amendment moved the endpoint without touching that clause, so the highlight is
 * recomputed here from the text the user typed — the only thing on this side
 * that knows what was searched for.
 *
 * The safety property the structured runs bought is kept exactly: a matched run
 * becomes a `<mark>` **element React creates** and an unmatched run becomes a
 * text node, so there is no HTML string anywhere on this path and no sanitizer
 * to get wrong. A snippet containing `<script>` reaches the DOM as the eight
 * characters it is (sprint-010 Open Conflict 4).
 */

/** One run of the snippet: literal text, and whether the query matched it. */
export interface SnippetSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface SnippetProps {
  /** The hit's `snippet` — plain text, one line, never a body. */
  readonly snippet: string;
  /** The query it was matched against, for the highlight. */
  readonly query: string;
}

export function Snippet({ snippet, query }: SnippetProps): ReactElement {
  return (
    <div className="sr-snippet">
      {highlight(snippet, query).map((segment, index) =>
        segment.match ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </div>
  );
}

/**
 * Splits a snippet into marked and unmarked runs.
 *
 * A deliberately literal, whole-string-only match on each whitespace-separated
 * word of the query, case-insensitive. It is a *reader's* highlight, not a
 * reimplementation of the server's ranking: the server decided what matched and
 * which line to send, and this only points at the words inside it. Anything
 * cleverer — stemming, prefix expansion, fuzzy spans — would draw marks the
 * ranking does not stand behind, and would drift from FTS5's behaviour the first
 * time either side changed.
 *
 * Longer words are matched first so that `mortgage rate` marks `mortgage`
 * whole rather than leaving a stray fragment behind a shorter overlapping term,
 * and matched regions never overlap.
 */
export function highlight(text: string, query: string): readonly SnippetSegment[] {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (text === "" || terms.length === 0) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let from = haystack.indexOf(term);
    while (from !== -1) {
      // A region already claimed by a longer term is left alone rather than
      // re-split, which is what keeps the runs non-overlapping.
      if (!marked.slice(from, from + term.length).some(Boolean)) {
        marked.fill(true, from, from + term.length);
      }
      from = haystack.indexOf(term, from + term.length);
    }
  }

  const segments: SnippetSegment[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      segments.push({ text: text.slice(start, index), match: marked[start] === true });
      start = index;
    }
  }
  return segments;
}
