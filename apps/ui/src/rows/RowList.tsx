import { Row, useDocs, type RowNotice } from "@corpus/kit";
import type { DocRow } from "@corpus/contract";
import { useState, type ReactElement } from "react";
import "./RowList.css";

/**
 * **Scaffolding.** UI-003 owns the board's columns — pinned `type: view`
 * documents, their queries, their order and the `ColumnList` that renders their
 * results. Until that lands, this is the one place the kit's `Row` reaches a
 * real browser against a real server, which is what makes UI-004's staleness
 * ramp, badges and quick actions verifiable at all.
 *
 * It is deliberately dumb: one unfiltered `useDocs()`, one column-shaped card,
 * and `Row` for every result. It carries **no** column semantics — no stored
 * query, no `order`, no chips, no title from a view document — precisely so that
 * UI-003 replaces it wholesale rather than inheriting a second, hardcoded notion
 * of what a column is.
 */

/** The prototype's column width, so the row's truncation is exercised for real. */
export const SCAFFOLD_COLUMN_TITLE = "All documents";

export interface RowListProps {
  /** Injectable so a test can drive the notice log without a real mutation. */
  readonly onOpen?: ((row: DocRow) => void) | undefined;
}

export function RowList({ onOpen }: RowListProps = {}): ReactElement {
  const docs = useDocs({});
  // A local log, not a toast surface: sprint-009 assigns the toast to UI-003 and
  // says only one of the two UI issues may create it. Row failures also render
  // inside the row itself, as an `role="alert"` line.
  const [notices, setNotices] = useState<readonly RowNotice[]>([]);

  const items = docs.data?.items ?? [];
  // The board is never a blank screen: a pending query, a failed one, and a
  // genuinely empty corpus all say the same honest thing. What the *server* is
  // doing is the console strip's job to report, not this list's.
  if (items.length === 0) return <p className="board-empty">No lists yet</p>;

  return (
    <section className="col rows-scaffold" aria-label={SCAFFOLD_COLUMN_TITLE}>
      <header className="col-head">
        <span className="col-title">{SCAFFOLD_COLUMN_TITLE}</span>
        <span className="col-kind">scaffold</span>
        <span className="col-count">{docs.data?.page.total ?? items.length}</span>
      </header>
      <div className="col-list">
        {items.map((row) => (
          <Row
            key={row.id}
            row={row}
            {...(onOpen ? { onOpen } : {})}
            onNotify={(notice) => {
              setNotices((current) => [notice, ...current].slice(0, 3));
            }}
          />
        ))}
      </div>
      {notices.length > 0 ? (
        <ul className="rows-notices" aria-live="polite">
          {notices.map((notice, index) => (
            <li key={`${notice.tone}-${String(index)}`} data-notice-tone={notice.tone}>
              {notice.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
