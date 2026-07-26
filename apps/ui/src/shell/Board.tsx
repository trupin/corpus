import type { ReactElement } from "react";
import "./Board.css";

/**
 * The board scroller. Columns are pinned `type: view` documents (SPEC.md §11)
 * and arrive with UI-003; until then the scroller renders its empty state, so
 * the layout, the snap axis and the scrollbar are all real from day one.
 */
export function Board(): ReactElement {
  return (
    <main className="board" aria-label="Document lists">
      <p className="board-empty">No lists yet</p>
    </main>
  );
}
