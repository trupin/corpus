import type { RelatedDoc } from "@corpus/contract";
import type { ReactElement } from "react";

/**
 * "Related" (SPEC.md §10, §9.2): the ranked related set for the open document,
 * from `GET /api/docs/{id}/related` — the same answer `corpus doc related`
 * gives the agent, rendered for a person.
 *
 * It sits **beside** the backlinks panel and does not replace it, because the
 * two answer different questions. "Referenced by" is a fact about this
 * document's text — someone wrote a `[[ref]]` to it — and is complete. "Related"
 * is a *ranking*, capped, and from Retrieval Phase B it includes documents that
 * link to nothing at all: a note is `similar` because the semantic index says
 * so, and that is a claim rather than a fact.
 *
 * **The relation is rendered, never interpreted.** Each row says why it is
 * related in the server's own word — `linked`, `similar`, `both` — with no
 * client-side branch on which retrieval phase produced it and no re-sort. The
 * vocabulary was frozen before Phase B shipped precisely so this component could
 * be written once: a value it has never seen still renders as the label it is,
 * instead of falling through a match and disappearing.
 *
 * Clicking a row pushes onto the reader's navigation stack exactly like a
 * `[[ref]]` or a backlink — SPEC.md §10's three sources of one history, now
 * four.
 *
 * Empty renders `null`, the rule `Backlinks.tsx` sets: a heading over nothing is
 * a claim that the corpus was searched and found wanting, which for a document
 * nobody has linked yet is just noise.
 */

export interface RelatedPanelProps {
  readonly related: readonly RelatedDoc[];
  readonly onOpen: (docId: string) => void;
}

export function RelatedPanel({ related, onOpen }: RelatedPanelProps): ReactElement | null {
  if (related.length === 0) return null;
  return (
    <div className="related">
      <h3>Related</h3>
      {related.map((row) => (
        <div className="related-doc" key={row.id}>
          <button
            type="button"
            className="ref"
            data-related={row.id}
            onClick={() => {
              onOpen(row.id);
            }}
          >
            {row.title}
          </button>
          <span className="relation" data-relation={row.relation}>
            {row.relation}
          </span>
        </div>
      ))}
    </div>
  );
}
