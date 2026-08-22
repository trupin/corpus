import type { DocRow } from "@corpus/contract";
import { Row, type RowNotice } from "@corpus/kit";
import { useEffect, useRef, type ReactElement } from "react";
import { useContextMenu } from "../menu/ContextMenuHost";
import { keepsNativeMenu } from "../menu/nativeMenu";
import { RowMenuItems, subjectFromRow } from "../menu/RowMenuItems";
import type { BoardColumn } from "./viewDoc";

/**
 * A column's scrolling list of results (`design/index.html`'s `.col-list`).
 *
 * **The row seam.** Every result is rendered by exactly one component — the
 * kit's `Row` — taking the document record plus the callbacks the column
 * supplies, and nothing else. A row is told what it is and who to call; it is
 * never told which column it is in, which is what lets the same component
 * render in a board column and in a search result list. There is no per-type
 * renderer and no delegate: one row anatomy, drawn for every document.
 */

/** How long the list may go without persisting a scroll position it is given. */
const SCROLL_PERSIST_MS = 150;

export interface ColumnListProps {
  readonly column: BoardColumn;
  readonly items: readonly DocRow[];
  readonly isPending: boolean;
  readonly error: Error | null;
  /** Restored browser-local scroll position (SPEC.md §10). */
  readonly scrollTop: number;
  /**
   * The document the keyboard cursor is on, or `null` — the prototype's
   * `.row.kbd` outline. Passed down rather than applied from outside so exactly
   * one row can ever carry it.
   */
  readonly cursorDocId: string | null;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpen: (row: DocRow) => void;
  /** SPEC.md §10's "open in focus" — the ⇧↵ act, offered by the row's menu. */
  readonly onOpenFocus: (row: DocRow) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ColumnList({
  items,
  isPending,
  error,
  scrollTop,
  cursorDocId,
  onScroll,
  onOpen,
  onOpenFocus,
  onNotify,
}: ColumnListProps): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const menu = useContextMenu();
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
      onContextMenu={(event) => {
        const element = (event.target as Element | null)?.closest?.<HTMLElement>("[data-row-doc]");
        const row = items.find((item) => item.id === element?.dataset["rowDoc"]);
        // Off any row, or inside a field: the browser's menu. A selection —
        // here, or anywhere else on the page — does not suppress a row's own
        // menu (SPEC.md §10, user report 2026-07-30).
        if (row === undefined) return;
        // The browser keeps its menu inside an editable field and nowhere else
        // here — `keepsNativeMenu` is where that rule lives. The row's **type**
        // is not consulted at all, and must not be: a document whose type this
        // build does not recognise is a core row for a core subject, and it gets
        // the same actions as every other row (UI-036).
        if (keepsNativeMenu({ target: event.target })) return;
        event.preventDefault();
        menu.open({
          label: `Actions for ${row.title}`,
          clientX: event.clientX,
          clientY: event.clientY,
          items: (close) => (
            <RowMenuItems
              subject={subjectFromRow(row)}
              close={close}
              onOpen={() => {
                onOpen(row);
              }}
              onOpenFocus={() => {
                onOpenFocus(row);
              }}
              onNotify={onNotify}
            />
          ),
        });
      }}
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
