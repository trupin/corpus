import type { DocRow } from "@corpus/contract";
import { useDocs, type OpenPayload, type RowNotice } from "@corpus/kit";
import { useState, type DragEvent, type ReactElement } from "react";
import { Reader } from "../reader/Reader";
import { unreflectedCount } from "../reflect/unreflected";
import { useReflectStatus } from "../reflect/useReflectStatus";
import { ColumnHead } from "./ColumnHead";
import { ColumnList } from "./ColumnList";
import { openDocId, type ColumnLocalState, type NavEntry } from "./useBoardLocalState";
import { useColumnWidth } from "./useColumnWidth";
import type { BoardColumn } from "./viewDoc";

/**
 * One column card (`design/index.html`'s `.col`): a view document the showing
 * board lists, rendered.
 *
 * The card snaps to the board's scroll axis and carries the `.kactive` cue
 * while it is the keyboard's active column. Its header is the drag handle; the
 * drag itself belongs to the board, because reordering rewrites the board
 * document's whole `columns` array and this card is one entry in it.
 *
 * **Its width is the view document's** (SPEC.md §10), not a constant and not a
 * browser-local preference — and since rider 3 it is the *whole* answer: a
 * query column **no longer widens when it opens a reader**. Clicking a row
 * opens a path column to the right (`PathBand`), which has its own width; the
 * reader this card can still hold in place is "open here"'s, at the column's
 * own width. The right edge is the resize handle; the header arms the reorder
 * drag and the edge stops the press from reaching it.
 */

export interface ColumnProps {
  readonly column: BoardColumn;
  readonly isActive: boolean;
  readonly isDragging: boolean;
  /** Lit for 1.5 s after the board scrolled this column into view (SPEC.md §10). */
  readonly isFlashing: boolean;
  readonly local: ColumnLocalState;
  /** True when the open document was just created — its title is selected. */
  readonly selectTitle: boolean;
  /** The row the keyboard cursor is on, when this is the active column (SPEC.md §10). */
  readonly cursorDocId: string | null;
  /**
   * The document whose row is this column's path **origin** (rider 3): the row
   * carries the accent bar and `▸` while its path is open. Derived from the
   * strip at render, never stored on the row.
   */
  readonly originDocId: string | null;
  /** Every document open on the board — rows elsewhere carry a dot. */
  readonly openDocIds: ReadonlySet<string>;
  readonly onActivate: () => void;
  readonly onScroll: (scrollTop: number) => void;
  /**
   * A row was picked (click, `↵`, the menu's Open): a path hangs off it,
   * directly to this column's right (rider 3). The board owns the act.
   */
  readonly onOpenRow: (docId: string) => void;
  /**
   * "Open here" — the reader the column always had: a push onto this column's
   * own navigation stack. A bare id opens at the top; a request may also say
   * where inside the document to land (UI-037).
   */
  readonly onOpen: (target: OpenPayload) => void;
  /** Replaces the reader's navigation stack; `[]` returns to the list. */
  readonly onNav: (nav: readonly NavEntry[]) => void;
  readonly onFocusMode: (target: OpenPayload) => void;
  readonly onAdd: () => void;
  readonly onRename: (title: string) => void;
  readonly onEditQuery: (query: Readonly<Record<string, string>>) => void;
  readonly onRemove: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

interface ColumnBodyProps {
  readonly column: BoardColumn;
  readonly local: ColumnLocalState;
  readonly cursorDocId: string | null;
  readonly originDocId: string | null;
  readonly openDocIds: ReadonlySet<string>;
  readonly onHandle: (armed: boolean) => void;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpenRow: (docId: string) => void;
  readonly onOpenHere: (target: OpenPayload) => void;
  readonly onOpenFocus: (target: OpenPayload) => void;
  readonly onAdd: () => void;
  readonly onRename: (title: string) => void;
  readonly onEditQuery: (query: Readonly<Record<string, string>>) => void;
  readonly onRemove: () => void;
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
  originDocId,
  openDocIds,
  onHandle,
  onScroll,
  onOpenRow,
  onOpenHere,
  onOpenFocus,
  onAdd,
  onRename,
  onEditQuery,
  onRemove,
  onNotify,
}: ColumnBodyProps): ReactElement {
  // The compiled filter is the wire's own form — every value a string, arrays
  // comma-joined — which is what the kit forwards verbatim. Unknown filters
  // pass through too: the contract can grow one without this file changing.
  const docs = useDocs(column.filter);
  /*
   * The corpus's reflection clock (SPEC.md §7's rider 9). One cache entry for
   * the whole page — every column observes the same `["reflect"]` query — so
   * marking a column costs no request of its own, and `undefined` while it is in
   * flight is passed down as itself rather than flattened into `null`, which on
   * the wire means *never reflected* and would mark everything.
   */
  const reflected = useReflectStatus().data?.reflected;

  return (
    <>
      <ColumnHead
        column={column}
        count={docs.data?.page.total ?? null}
        changed={reflected === undefined ? 0 : unreflectedCount(docs.data?.items ?? [], reflected)}
        onAdd={onAdd}
        onRename={onRename}
        onEditQuery={onEditQuery}
        onRemove={onRemove}
        onHandle={onHandle}
      />
      <ColumnList
        column={column}
        items={docs.data?.items ?? []}
        isPending={docs.isPending}
        error={docs.error}
        scrollTop={local.scroll}
        reflected={reflected}
        cursorDocId={cursorDocId}
        originDocId={originDocId}
        openDocIds={openDocIds}
        onScroll={onScroll}
        onOpen={(row: DocRow) => {
          onOpenRow(row.id);
        }}
        onOpenHere={(row: DocRow) => {
          onOpenHere(row.id);
        }}
        onOpenFocus={(row: DocRow) => {
          onOpenFocus(row.id);
        }}
        onNotify={onNotify}
      />
    </>
  );
}

export function Column(props: ColumnProps): ReactElement {
  const { column, isActive, isDragging, isFlashing, local, onActivate, onOpen } = props;
  const [draggable, setDraggable] = useState(false);
  const open = openDocId(local);

  const size = useColumnWidth({
    // The **view** document, not the slot: width rides the view's `extra`
    // (SPEC.md §10, unchanged by rider 2), so two boards listing one view share
    // its width, which is what "synced to every browser" already meant.
    viewDocId: column.viewId,
    title: column.title,
    stored: column.width,
    onNotify: props.onNotify,
  });

  const className = [
    "col",
    "qcol",
    isDragging ? "dragging" : "",
    isActive ? "kactive" : "",
    isFlashing ? "flash" : "",
    open === null ? "" : "reading",
    size.resizing ? "resizing" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <section
      className={className}
      data-col={column.id}
      aria-label={`${column.title} list`}
      // Rider 3: "a query column no longer widens when it opens a reader" — the
      // rendered width is the chosen width, reading or not.
      style={{ width: `${String(size.width)}px` }}
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
          originDocId={props.originDocId}
          openDocIds={props.openDocIds}
          onHandle={setDraggable}
          onScroll={props.onScroll}
          onOpenRow={props.onOpenRow}
          onOpenHere={onOpen}
          onOpenFocus={(target) => {
            props.onFocusMode(target);
          }}
          onAdd={props.onAdd}
          onRename={props.onRename}
          onEditQuery={props.onEditQuery}
          onRemove={props.onRemove}
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
            onRemove={props.onRemove}
            onHandle={setDraggable}
          />
          <div className="col-list">
            <div className="col-card col-card-error" role="alert">
              <p className="col-card-title">
                {column.missing
                  ? "This column names a view document that is not there"
                  : "This list’s view document is unreadable"}
              </p>
              <p className="col-card-body">
                “{column.title}” ({column.viewId}) — {column.error}.
              </p>
              {/*
               * A missing view has nothing to open — the id resolves to no
               * document at all — so the card offers the act that applies: the
               * ⋯ menu's "Remove from this board", which is the whole of its
               * menu here.
               */}
              {column.missing ? null : (
                <button
                  type="button"
                  className="col-card-action"
                  onClick={() => {
                    onOpen(column.viewId);
                  }}
                >
                  Open the view document
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div
        className="col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.title}`}
        aria-valuenow={Math.round(size.width)}
        aria-valuemin={size.min}
        aria-valuemax={size.max}
        tabIndex={0}
        onPointerDown={size.onPointerDown}
        onKeyDown={size.onKeyDown}
        onMouseDown={(event) => {
          // The header arms `draggable` on mousedown; the edge must never do it.
          event.stopPropagation();
        }}
      />

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
