import type { DocRow } from "@corpus/contract";
import { useDocs, type OpenPayload, type RowNotice } from "@corpus/kit";
import { useEffect, useLayoutEffect, useState, type DragEvent, type ReactElement } from "react";
import { Reader } from "../reader/Reader";
import { ColumnHead } from "./ColumnHead";
import { ColumnList } from "./ColumnList";
import { readingFloor, renderedWidth } from "./columnWidth";
import { openDocId, type ColumnLocalState, type NavEntry } from "./useBoardLocalState";
import { useColumnWidth } from "./useColumnWidth";
import type { BoardColumn } from "./viewDoc";

/**
 * One column card (`design/index.html`'s `.col`): a pinned view document,
 * rendered.
 *
 * The card snaps to the board's scroll axis and carries the `.kactive` cue
 * while it is the keyboard's active column. Its header is the drag handle; the
 * drag itself belongs to the board, because reordering is about the whole set
 * and the `order` values written are the neighbours' as much as this one's.
 *
 * **Its width is the view document's** (SPEC.md §10), not a constant and not a
 * browser-local preference: `336px` is only what a column with no chosen width
 * renders at, and opening a reader widens it *relative to* whatever the user
 * chose. The right edge is the handle; the two drags cannot fight, because the
 * header arms the reorder and the edge stops the press from reaching it.
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
  readonly onActivate: () => void;
  readonly onScroll: (scrollTop: number) => void;
  /**
   * Opens a document in this column's reader — a push onto its navigation
   * stack. A bare id opens it at the top; a request may also say where inside
   * the document to land (UI-037).
   */
  readonly onOpen: (target: OpenPayload) => void;
  /** Replaces the reader's navigation stack; `[]` returns to the list. */
  readonly onNav: (nav: readonly NavEntry[]) => void;
  readonly onFocusMode: (target: OpenPayload) => void;
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
  readonly onOpen: (target: OpenPayload) => void;
  readonly onOpenFocus: (target: OpenPayload) => void;
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
  onOpenFocus,
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
  /**
   * The floor this column has been grown to, if any (UI-113).
   *
   * Transient by design — see `renderedWidth`. It ratchets up when a reader
   * opens in a column too narrow to show it, never comes back down on close,
   * and is cleared the moment the user resizes, because their gesture is the
   * authority on width and a surviving floor would refuse to be narrowed.
   */
  const [grownTo, setGrownTo] = useState(0);

  const size = useColumnWidth({
    viewDocId: column.id,
    title: column.title,
    stored: column.width,
    onNotify: props.onNotify,
  });

  // Grow when a reader opens in a column too narrow to show it — the one
  // automatic width change the user asked to keep ("it can resize up
  // automatically but not down").
  //
  // **Before the browser paints, never after** (UI-146). `useEffect` runs after
  // the paint, so the reader's first painted frame was the one at the *old*
  // width — and where the document was already in the query cache (opening it
  // in a second column, or reopening one) the body itself painted in that
  // frame. Measured: body top 444.5 at the column's 336px, then 346.8 eleven
  // milliseconds later at 560px — the document moving 97.7px under a reader who
  // had already been shown it. A layout effect puts the width change in the
  // same commit as the mount, so there is one paint and it is the settled one.
  const reading = open !== null;
  useLayoutEffect(() => {
    if (!reading) return;
    const width = typeof window === "undefined" ? 0 : window.innerWidth;
    setGrownTo((current) => Math.max(current, readingFloor(size.width, width)));
  }, [reading, size.width]);

  // A resize is the user speaking about width, so the floor stops speaking. Held
  // to the gesture rather than to the resulting number: dragging *up* should
  // clear it too, or the column would silently refuse to be narrowed afterwards.
  useEffect(() => {
    if (size.resizing) setGrownTo(0);
  }, [size.resizing]);

  const className = [
    "col",
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
      style={{
        width: `${String(
          renderedWidth(size.width, grownTo, typeof window === "undefined" ? 0 : window.innerWidth),
        )}px`,
      }}
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
          onOpenFocus={(target) => {
            // Same act as `⇧↵`: the document opens in its column *and* full
            // screen, so closing focus leaves the reader where it belongs. A
            // reveal rides along to both, so the surface the user ends up
            // looking at is the one that lands on it.
            onOpen(target);
            props.onFocusMode(target);
          }}
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
