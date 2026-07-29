import type { DocRow } from "@corpus/contract";
import { useDocs } from "@corpus/kit";
import type { ColumnComponentProps } from "@corpus/kit/plugin";
import type { ReactElement } from "react";
import { isOverdue, itemsOrEmpty, openItems, type TodoItem } from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";
import "./todos.css";

/**
 * The "Todos" board column (SPEC.md §10, §12): every **open** item across every
 * todo document, grouped by the list it came from.
 *
 * This is the kit-only proof. The component imports `@corpus/kit` and
 * `@corpus/contract` and nothing else — no `apps/ui` internals, no transport
 * of its own, no privileged access of any kind — and it still feels native,
 * because everything it needs is published: the collection query, the design
 * tokens, and the board's own open-a-document capability.
 *
 * **One query, no N+1.** `extra` rides every list row (`docRowBaseShape` in
 * `@corpus/contract`), so a single `useDocs` returns each document's `items`
 * with the list and the flattening happens client-side. There is no aggregate
 * endpoint and there should not be one: a column that needed a bespoke route
 * for a filter over data it already has would be a column core cannot reason
 * about. SSE invalidation is included transparently — checking an item
 * anywhere invalidates `["docs"]` through the core write path and this column
 * repaints without a reload.
 *
 * **Archived documents are excluded** because the default result set excludes
 * them (SPEC.md §11); the column states no `status` and therefore inherits
 * core's answer rather than inventing a second one.
 */

/** Wide content belongs in focus mode (SPEC.md §10) — the column body stays narrow. */
const MAX_ITEMS_PER_LIST = 5;

interface TodoGroup {
  readonly docId: string;
  readonly title: string;
  readonly items: readonly TodoItem[];
}

/** Open items, grouped by their source document, empty lists dropped. */
export function groupOpenItems(rows: readonly DocRow[]): readonly TodoGroup[] {
  const groups: TodoGroup[] = [];
  for (const row of rows) {
    const open = openItems(itemsOrEmpty(row));
    if (open.length === 0) continue;
    groups.push({ docId: row.id, title: row.title, items: open });
  }
  return groups;
}

export interface TodosColumnProps extends ColumnComponentProps {
  /** Injectable clock, so a test can pin the overdue boundary. */
  readonly now?: Date | undefined;
}

export function TodosColumn({ viewDocId, onOpen, now }: TodosColumnProps): ReactElement {
  // Deliberately the column type's own query rather than the view document's:
  // this column *is* "open todo items", and a stored filter that excluded
  // `type: todo` would leave the component rendering nothing it can explain.
  const docs = useDocs({ type: TODO_DOC_TYPE });
  const today = now ?? new Date();

  if (docs.error !== null) {
    return (
      <div className="col-card col-card-error" role="alert" data-todos-column={viewDocId}>
        Todos could not be loaded: {docs.error.message}
      </div>
    );
  }
  if (docs.data === undefined) {
    return (
      <p className="col-empty" data-todos-column={viewDocId}>
        Loading…
      </p>
    );
  }

  const groups = groupOpenItems(docs.data.items);
  if (groups.length === 0) {
    return (
      <p className="col-empty" data-todos-column={viewDocId}>
        Nothing open. Every todo list is clear.
      </p>
    );
  }

  return (
    <div className="todos-column" data-todos-column={viewDocId}>
      {groups.map((group) => (
        <section className="todos-group" key={group.docId} data-todos-group={group.docId}>
          <button type="button" className="todos-group-head" onClick={() => onOpen?.(group.docId)}>
            <span className="todos-group-title">{group.title}</span>
            <span className="todos-group-count">{group.items.length}</span>
          </button>
          <div className="check-list">
            {group.items.slice(0, MAX_ITEMS_PER_LIST).map((item, index) => (
              <button
                type="button"
                key={`${item.ts}:${String(index)}`}
                className={`check${isOverdue(item, today) ? " overdue" : ""}`}
                onClick={() => onOpen?.(group.docId)}
              >
                <span className="box">☐</span>
                <span className="todo-item-text">{item.text}</span>
                {item.due === undefined ? null : (
                  <span className="due" data-overdue={isOverdue(item, today) ? "true" : "false"}>
                    {item.due}
                  </span>
                )}
              </button>
            ))}
            {group.items.length > MAX_ITEMS_PER_LIST ? (
              <button
                type="button"
                className="check todo-more"
                onClick={() => onOpen?.(group.docId)}
              >
                +{group.items.length - MAX_ITEMS_PER_LIST} more
              </button>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
