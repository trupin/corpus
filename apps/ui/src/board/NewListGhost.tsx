import type { ReactElement } from "react";

/**
 * The trailing ghost column (`design/index.html`'s `.col.ghost-col`), verbatim:
 * dashed, `220px`, a `＋` and one line of copy.
 *
 * It is also the board's empty state. A workspace with no pinned view documents
 * shows exactly this and nothing else — never a blank screen, and never a
 * "there are no columns" apology, because the useful thing to do next is make
 * one.
 */

export const NEW_LIST_COPY = "New list — a folder, a view, or any filter";

export interface NewListGhostProps {
  readonly onOpen: (clientX: number, clientY: number) => void;
}

export function NewListGhost({ onOpen }: NewListGhostProps): ReactElement {
  return (
    <button
      type="button"
      className="col ghost-col"
      aria-label={NEW_LIST_COPY}
      aria-haspopup="menu"
      onClick={(event) => {
        onOpen(event.clientX, event.clientY);
      }}
    >
      <span className="plus" aria-hidden="true">
        ＋
      </span>
      <p>{NEW_LIST_COPY}</p>
    </button>
  );
}
