import type { ReactElement } from "react";

/**
 * `＋ Create "<query>" — opens ready to edit, in inbox/` — the zero-form
 * creation path (SPEC.md §10).
 *
 * The whole point is what is *absent*: no form, no folder picker, no type
 * chooser, no dialog. A query that names nothing yet becomes a document with
 * that title, in `data/docs/inbox/`, open with its title selected. The row is
 * rendered by the results list rather than by the overlay so it participates in
 * the `↑`/`↓` cursor like any other row.
 *
 * The query is a text node inside a serif `<b>`, so a query containing `<b>`
 * renders as those three characters.
 */

export interface CreateRowProps {
  readonly query: string;
  readonly isCursor: boolean;
  readonly onActivate: () => void;
}

export function CreateRow({ query, isCursor, onActivate }: CreateRowProps): ReactElement {
  return (
    <button
      type="button"
      className={isCursor ? "sr sr-create kbd" : "sr sr-create"}
      data-sr-create=""
      onClick={onActivate}
    >
      ＋ Create &quot;<b>{query}</b>&quot; — opens ready to edit, in inbox/
    </button>
  );
}
