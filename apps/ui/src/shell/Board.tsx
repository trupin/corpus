import type { ReactElement } from "react";
import { RowList } from "../rows/RowList";
import "./Board.css";

/**
 * The board scroller. Columns are pinned `type: view` documents (SPEC.md §11)
 * and arrive with UI-003; until then the scroller carries UI-004's row
 * scaffolding, so the layout, the snap axis and the scrollbar are all real from
 * day one — and so the kit's `Row` has a real browser to be verified in.
 *
 * `RowList` renders the honest empty state ("No lists yet") whenever it has
 * nothing to show — including while the collection query is pending and when it
 * failed, which is what a board with no reachable workspace server sees.
 */
export function Board(): ReactElement {
  return (
    <main className="board" aria-label="Document lists">
      <RowList />
    </main>
  );
}
