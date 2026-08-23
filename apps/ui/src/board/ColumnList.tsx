import { isUnreflected, type DocRow } from "@corpus/contract";
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
  /** The origin row of this column's open path, or `null` (SPEC.md §10, rider 3). */
  readonly originDocId: string | null;
  /** Documents open on the board — their rows here carry the dot (rider 3). */
  readonly openDocIds: ReadonlySet<string>;
  /**
   * The corpus's reflection clock (SPEC.md §7's rider 9), in **three** states.
   *
   * A timestamp is the clock. `null` is the clock the wire actually sends for a
   * corpus nobody has reflected on, under which every unarchived document not
   * last written by the agent *is* unreflected — so it marks the column, and
   * that is correct rather than alarming. `undefined` is the state that is not
   * on the wire at all: this browser has not read `GET /api/workspace/reflect`
   * yet, and it marks nothing, because "never reflected" is a claim about the
   * corpus and a page that has asked nobody is in no position to make it.
   *
   * Two nullish values look like one bug and are not: collapsing them would
   * either light every row for one round trip on load, or silently stop marking
   * a workspace whose agent has never run.
   */
  readonly reflected: string | null | undefined;
  readonly onScroll: (scrollTop: number) => void;
  /** A row was picked: a path opens off it (SPEC.md §10, rider 3). */
  readonly onOpen: (row: DocRow) => void;
  /** "Open here" — the column's own in-place reader (`⌥↵`, the row menu). */
  readonly onOpenHere: (row: DocRow) => void;
  /** SPEC.md §10's "open in full screen" — the ⇧↵ act, offered by the row's menu. */
  readonly onOpenFocus: (row: DocRow) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ColumnList({
  items,
  isPending,
  error,
  scrollTop,
  cursorDocId,
  originDocId,
  openDocIds,
  reflected,
  onScroll,
  onOpen,
  onOpenHere,
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
              onOpenHere={() => {
                onOpenHere(row);
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
            origin={row.id === originDocId}
            openElsewhere={row.id !== originDocId && openDocIds.has(row.id)}
            /*
             * The mark compares two timestamps already on hand — this row's
             * `updated` and the corpus's clock — with the contract's own
             * predicate, the same call `GET /api/workspace/reflect` counts
             * `changed` with. No per-row request, and no second rule that could
             * disagree with the number on the board bar.
             */
            unreflected={reflected === undefined ? false : isUnreflected(row, reflected)}
            onOpen={onOpen}
            onNotify={onNotify}
          />
        ))
      )}
    </div>
  );
}
