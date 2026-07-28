import type { DocRow } from "@corpus/contract";
import { useDocs, type RowNotice } from "@corpus/kit";
import { useState, type DragEvent, type ReactElement } from "react";
import { Reader } from "../reader/Reader";
import { ColumnHead } from "./ColumnHead";
import { ColumnList } from "./ColumnList";
import { openDocId, type ColumnLocalState, type NavEntry } from "./useBoardLocalState";
import type { BoardColumn } from "./viewDoc";

/**
 * One column card (`design/index.html`'s `.col`): a pinned view document,
 * rendered.
 *
 * The card is `336px`, snaps to the board's scroll axis, and carries the
 * `.kactive` cue while it is the keyboard's active column. Its header is the
 * drag handle; the drag itself belongs to the board, because reordering is
 * about the whole set and the `order` values written are the neighbours' as
 * much as this one's.
 */

export interface ColumnProps {
  readonly column: BoardColumn;
  readonly isActive: boolean;
  readonly isDragging: boolean;
  /** Lit for 1.5 s after the board scrolled this column into view (SPEC.md §11). */
  readonly isFlashing: boolean;
  readonly local: ColumnLocalState;
  /** True when the open document was just created — its title is selected. */
  readonly selectTitle: boolean;
  /** The row the keyboard cursor is on, when this is the active column (SPEC.md §11). */
  readonly cursorDocId: string | null;
  readonly onActivate: () => void;
  readonly onScroll: (scrollTop: number) => void;
  /** Opens a document in this column's reader — a push onto its navigation stack. */
  readonly onOpen: (docId: string) => void;
  /** Replaces the reader's navigation stack; `[]` returns to the list. */
  readonly onNav: (nav: readonly NavEntry[]) => void;
  readonly onFocusMode: (docId: string) => void;
  readonly onAdd: () => void;
  readonly onRename: (title: string) => void;
  readonly onEditQuery: (query: Readonly<Record<string, string>>) => void;
  readonly onUnpin: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

interface ColumnBodyProps {
  readonly column: BoardColumn;
  readonly local: ColumnLocalState;
  readonly cursorDocId: string | null;
  readonly onHandle: (armed: boolean) => void;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpen: (docId: string) => void;
  readonly onAdd: () => void;
  readonly onRename: (title: string) => void;
  readonly onEditQuery: (query: Readonly<Record<string, string>>) => void;
  readonly onUnpin: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * The fetching half, mounted only when the view document is readable.
 *
 * Split from `Column` so a column whose own frontmatter is broken issues no
 * query at all: sending a filter compiled from a document we have just declared
 * unreadable would be asking the server to make sense of it for us.
 */
function ColumnBody({
  column,
  local,
  cursorDocId,
  onHandle,
  onScroll,
  onOpen,
  onAdd,
  onRename,
  onEditQuery,
  onUnpin,
  onNotify,
}: ColumnBodyProps): ReactElement {
  // The compiled filter is the wire's own form — every value a string, arrays
  // comma-joined — which is what the kit forwards verbatim. Unknown filters
  // pass through too: the contract can grow one without this file changing.
  const docs = useDocs(column.filter);

  const openRow = (row: DocRow): void => {
    onOpen(row.id);
  };

  return (
    <>
      <ColumnHead
        column={column}
        count={docs.data?.page.total ?? null}
        onAdd={onAdd}
        onRename={onRename}
        onEditQuery={onEditQuery}
        onUnpin={onUnpin}
        onHandle={onHandle}
      />
      <ColumnList
        column={column}
        items={docs.data?.items ?? []}
        isPending={docs.isPending}
        error={docs.error}
        scrollTop={local.scroll}
        cursorDocId={cursorDocId}
        onScroll={onScroll}
        onOpen={openRow}
        onNotify={onNotify}
      />
    </>
  );
}

export function Column(props: ColumnProps): ReactElement {
  const { column, isActive, isDragging, isFlashing, local, onActivate, onOpen } = props;
  const [draggable, setDraggable] = useState(false);
  const open = openDocId(local);

  const className = [
    "col",
    isDragging ? "dragging" : "",
    isActive ? "kactive" : "",
    isFlashing ? "flash" : "",
    open === null ? "" : "reading",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <section
      className={className}
      data-col={column.id}
      aria-label={`${column.title} list`}
      draggable={draggable}
      onMouseOver={onActivate}
      onFocus={onActivate}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move";
        // Chromium refuses to start a drag with an empty data transfer.
        event.dataTransfer.setData("text/plain", column.id);
        props.onDragStart();
      }}
      onDragEnd={() => {
        setDraggable(false);
        props.onDragEnd();
      }}
    >
      {column.error === null ? (
        <ColumnBody
          column={column}
          local={local}
          cursorDocId={props.cursorDocId}
          onHandle={setDraggable}
          onScroll={props.onScroll}
          onOpen={onOpen}
          onAdd={props.onAdd}
          onRename={props.onRename}
          onEditQuery={props.onEditQuery}
          onUnpin={props.onUnpin}
          onNotify={props.onNotify}
        />
      ) : (
        <>
          <ColumnHead
            column={column}
            count={null}
            onAdd={props.onAdd}
            onRename={props.onRename}
            onEditQuery={props.onEditQuery}
            onUnpin={props.onUnpin}
            onHandle={setDraggable}
          />
          <div className="col-list">
            <div className="col-card col-card-error" role="alert">
              <p className="col-card-title">This list&rsquo;s view document is unreadable</p>
              <p className="col-card-body">
                “{column.title}” ({column.id}) — {column.error}.
              </p>
              <button
                type="button"
                className="col-card-action"
                onClick={() => {
                  onOpen(column.id);
                }}
              >
                Open the view document
              </button>
            </div>
          </div>
        </>
      )}

      {open === null ? null : (
        <Reader
          columnId={column.id}
          columnTitle={column.title}
          nav={local.nav}
          setNav={props.onNav}
          selectTitle={props.selectTitle}
          isActive={isActive}
          onFocusMode={props.onFocusMode}
          onNotify={props.onNotify}
        />
      )}
    </section>
  );
}
