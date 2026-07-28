import type { Snippet as SnippetData } from "@corpus/contract";
import { Fragment, type ReactElement } from "react";

/**
 * A search highlight, rendered from the structured segments the server sends.
 *
 * `SnippetSchema` is `{text, match}` runs rather than marked-up HTML — its own
 * docblock says why: *"so the UI renders highlights without
 * `dangerouslySetInnerHTML` and without an escaping contract between server and
 * client."* So a matched run becomes a `<mark>` **element React creates**, and
 * an unmatched run becomes a text node. There is no HTML string anywhere on this
 * path, which is why there is no sanitizer to get wrong: a document body
 * containing `<script>` reaches this component as the six characters it is and
 * renders as those six characters (sprint-010 Open Conflict 4).
 *
 * The segment index is the key because segments have no identity of their own —
 * they are positions within one excerpt, and the whole excerpt is replaced
 * together on every response.
 */

export interface SnippetProps {
  readonly snippet: SnippetData;
}

export function Snippet({ snippet }: SnippetProps): ReactElement {
  return (
    <div className="sr-snippet">
      {snippet.segments.map((segment, index) =>
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
 * The one excerpt a result row shows.
 *
 * Body and turn matches say more than a title match, which the `.sr-title`
 * already displays in full; with several the first is taken, because the server
 * returns them in relevance order.
 */
export function primarySnippet(snippets: readonly SnippetData[]): SnippetData | null {
  return snippets.find((snippet) => snippet.field !== "title") ?? snippets[0] ?? null;
}
