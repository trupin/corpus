import type { DocRow } from "@corpus/contract";
import type { ReactElement } from "react";

/**
 * "Referenced by" (SPEC.md §11): every document whose body carries a `[[ref]]`
 * to this one, from the projection's `links` table via `GET
 * /api/docs?references=<id>`.
 *
 * One request for the whole panel, not one per candidate — the filter is the
 * server's, and the alternative (fetching every document and scanning bodies
 * client-side) is the shape of N+1 the collection query exists to prevent.
 *
 * Clicking a backlink pushes onto the reader's navigation stack exactly like a
 * `[[ref]]` does; SPEC.md §11 names refs, backlinks and thread-context links as
 * the three sources of one history.
 */

export interface BacklinksProps {
  readonly backlinks: readonly DocRow[];
  readonly onOpen: (docId: string) => void;
}

export function Backlinks({ backlinks, onOpen }: BacklinksProps): ReactElement | null {
  if (backlinks.length === 0) return null;
  return (
    <div className="backlinks">
      <h3>Referenced by</h3>
      {backlinks.map((row) => (
        <div className="backlink" key={row.id}>
          <span className="type-glyph">{row.type}</span>
          <button
            type="button"
            className="ref"
            data-backlink={row.id}
            onClick={() => {
              onOpen(row.id);
            }}
          >
            {row.title}
          </button>
        </div>
      ))}
    </div>
  );
}
