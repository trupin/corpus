import type { DocRow } from "@corpus/contract";
import { Row, type RowNotice } from "@corpus/kit";
import { useEffect, useRef, type ReactElement } from "react";
import type { BoardColumn } from "./viewDoc";

/**
 * A column's scrolling list of results (`design/index.html`'s `.col-list`).
 *
 * **The row seam.** Every result is rendered by exactly one component — the
 * kit's `Row` — taking the document record plus the callbacks the column
 * supplies, and nothing else. A row is told what it is and who to call; it is
 * never told which column it is in, which is what lets the same component
 * render in a board column, in a search result list, and inside a plugin's own
 * surface (PLUGINS-001 swaps it per document type through `Row`'s `ListItem`
 * seam, without this file changing).
 */

/** How long the list may go without persisting a scroll position it is given. */
const SCROLL_PERSIST_MS = 150;

export interface ColumnListProps {
  readonly column: BoardColumn;
  readonly items: readonly DocRow[];
  readonly isPending: boolean;
  readonly error: Error | null;
  /** Restored browser-local scroll position (SPEC.md §11). */
  readonly scrollTop: number;
  /**
   * The document the keyboard cursor is on, or `null` — the prototype's
   * `.row.kbd` outline. Passed down rather than applied from outside so exactly
   * one row can ever carry it.
   */
  readonly cursorDocId: string | null;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpen: (row: DocRow) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ColumnList({
  column,
  items,
  isPending,
  error,
  scrollTop,
  cursorDocId,
  onScroll,
  onOpen,
  onNotify,
}: ColumnListProps): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Once, and only after the first results have laid out — restoring against
    // an empty list would scroll to 0 and then overwrite the stored value.
    if (restored.current || list.current === null || items.length === 0) return;
    restored.current = true;
    list.current.scrollTop = scrollTop;
  }, [items.length, scrollTop]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (column.plugin !== null) {
    // No plugin registry exists yet (PLUGINS-001 ships discovery), so every
    // `column:` reference is by definition uninstalled today. The column keeps
    // its board position either way — SPEC.md §15 M5.
    return (
      <div className="col-list">
        <div className="col-card" role="note">
          <p className="col-card-title">Plugin not installed</p>
          <p className="col-card-body">
            This column renders <code>{column.plugin.plugin}</code>&rsquo;s{" "}
            <code>{column.plugin.type}</code> view. Install the plugin, or edit this list&rsquo;s
            query.
          </p>
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="col-list">
        <div className="col-card col-card-error" role="alert">
          <p className="col-card-title">This list could not be loaded</p>
          <p className="col-card-body">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={list}
      className="col-list"
      onScroll={(event) => {
        const next = event.currentTarget.scrollTop;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          onScroll(next);
        }, SCROLL_PERSIST_MS);
      }}
    >
      {items.length === 0 ? (
        <p className="col-empty">{isPending ? "Loading…" : "Nothing here."}</p>
      ) : (
        items.map((row) => (
          <Row
            key={row.id}
            row={row}
            cursor={row.id === cursorDocId}
            onOpen={onOpen}
            onNotify={onNotify}
          />
        ))
      )}
    </div>
  );
}
