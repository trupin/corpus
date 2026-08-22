import { useEffect, useRef, useState, type ReactElement } from "react";
import { ColumnMenuItems } from "../menu/ColumnMenuItems";
import { useContextMenu } from "../menu/ContextMenuHost";
import { keepsNativeMenu } from "../menu/nativeMenu";
import { QueryEditor } from "./query/QueryEditor";
import { shortSortLabel, useSortFit } from "./sortFit";
import { formatQueryString, parseQueryString, sameQuery, type BoardColumn } from "./viewDoc";

/**
 * A column's header: title, kind, live count, `＋`, `⋯`, and the stored query
 * rendered as filter chips with the sort label pushed right
 * (`design/index.html`'s `.col-head`).
 *
 * That row never wraps (UI-038): when the chips leave no room for the full sort
 * label, the label degrades to its short form rather than dropping to a second
 * line. `sortFit.ts` owns the measurement and the rule.
 *
 * The header is also the **drag handle** (`cursor: grab`). The prototype's
 * trick is kept exactly: `mousedown` arms `draggable` unless the press landed
 * on a button, and `mouseup` disarms it — which is what keeps `＋` and `⋯`
 * clickable inside a handle.
 *
 * Renaming happens in place here; editing the query is `QueryEditor`
 * (`./query/`), which adds completions and a syntax reference to the same field
 * without changing what it stores — `commit()` below is unchanged, including its
 * "a no-op edit writes nothing" rule.
 *
 * `⋯` and right-click open the **same** menu, from the same declaration and
 * through the same frame (SPEC.md §10's right-click bullet) — the header had
 * its own capture-phase mousedown and Escape handling before UI-018, which was
 * a third dismissal story racing the escape chain (sprint-016 TEST-442).
 */

export interface ColumnHeadProps {
  readonly column: BoardColumn;
  /** The live result count, or `null` while it is unknown. */
  readonly count: number | null;
  readonly onAdd: () => void;
  readonly onRename: (title: string) => void;
  readonly onEditQuery: (query: Readonly<Record<string, string>>) => void;
  readonly onUnpin: () => void;
  /** Arms/disarms the column's `draggable` attribute. */
  readonly onHandle: (armed: boolean) => void;
}

type Editing = "title" | "query" | null;

export function ColumnHead({
  column,
  count,
  onAdd,
  onRename,
  onEditQuery,
  onUnpin,
  onHandle,
}: ColumnHeadProps): ReactElement {
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();
  const sortFit = useSortFit(column.chips, column.sortLabel, editing !== "query");

  // Only the rename field: the query editor is its own component (UI-039) and
  // focuses itself, because it owns a menu and a help panel that must be able to
  // take focus without this effect stealing it back.
  useEffect(() => {
    if (editing !== "title") return;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  const startEditing = (mode: Exclude<Editing, null>): void => {
    setDraft(mode === "title" ? column.title : formatQueryString(column.filter));
    setEditing(mode);
  };

  const openMenu = (clientX: number, clientY: number, autoFocus: boolean): void => {
    menu.open({
      label: `List options for ${column.title}`,
      clientX,
      clientY,
      autoFocus,
      items: (close) => (
        <ColumnMenuItems
          close={close}
          onRename={() => {
            startEditing("title");
          }}
          onEditQuery={() => {
            startEditing("query");
          }}
          onUnpin={onUnpin}
        />
      ),
    });
  };

  const commit = (): void => {
    const value = draft.trim();
    if (editing === "title" && value !== "" && value !== column.title) onRename(value);
    if (editing === "query") {
      // Only a real change is written. Opening the field and clicking away is
      // not an edit, and the rename branch has always known it: a no-op `PUT`
      // still rewrites the view document, bumps `updated` and commits (PR #10
      // finding 19).
      const next = parseQueryString(value);
      if (!sameQuery(next, column.filter)) onEditQuery(next);
    }
    setEditing(null);
  };

  const onFieldKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
    }
  };

  return (
    <header
      className="col-head"
      onMouseDown={(event) => {
        // A press on a control is a click, not the start of a drag.
        if ((event.target as HTMLElement).closest("button, input") !== null) return;
        onHandle(true);
      }}
      onMouseUp={() => {
        onHandle(false);
      }}
      onContextMenu={(event) => {
        // The rename and edit-query fields are inputs: the browser's own menu is
        // the useful one there. A selection elsewhere does not suppress the
        // header's menu (SPEC.md §10, user report 2026-07-30).
        if (keepsNativeMenu({ target: event.target })) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY, false);
      }}
    >
      <div className="col-title-row">
        {editing === "title" ? (
          <input
            ref={field}
            className="col-title col-title-input"
            aria-label={`Rename ${column.title}`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={onFieldKeyDown}
          />
        ) : (
          <span className="col-title" title={column.title}>
            {column.title}
          </span>
        )}
        <span className="col-kind">{column.kind}</span>
        <span className="col-count">{count === null ? "—" : count}</span>
        <button
          type="button"
          className="col-add"
          aria-label={`New document in ${column.title}`}
          title="New document in this list"
          onClick={onAdd}
        >
          ＋
        </button>
        <button
          ref={menuButton}
          type="button"
          className="col-menu"
          aria-label={`List options for ${column.title}`}
          aria-haspopup="menu"
          onClick={() => {
            if (menu.isOpen) {
              menu.close();
              return;
            }
            const rect = menuButton.current?.getBoundingClientRect();
            openMenu(rect?.left ?? 0, (rect?.bottom ?? 0) + 4, false);
          }}
        >
          ⋯
        </button>
      </div>

      {editing === "query" ? (
        <QueryEditor
          columnTitle={column.title}
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={() => {
            setEditing(null);
          }}
        />
      ) : (
        <div className="chips" ref={sortFit.row}>
          {column.chips.map((chip) => (
            <span key={chip.key} className="chip on">
              {chip.label}
            </span>
          ))}
          <span className="sort" data-sort-compact={sortFit.compact ? "" : undefined}>
            {sortFit.compact ? shortSortLabel(column.sortLabel) : column.sortLabel}
          </span>
          {/*
           * The same row, out of flow, at `width: max-content`, always with the
           * full label. The visible chips shrink to whatever the column gives
           * them, so this copy is the only place the row's real requirement can
           * be read. It reuses `.chip`, deliberately: a twin class would let the
           * two drift and the measurement lie.
           */}
          <div className="chips-probe" aria-hidden="true" ref={sortFit.probe}>
            {column.chips.map((chip) => (
              <span key={chip.key} className="chip on">
                {chip.label}
              </span>
            ))}
            <span className="sort">{column.sortLabel}</span>
          </div>
        </div>
      )}
    </header>
  );
}
