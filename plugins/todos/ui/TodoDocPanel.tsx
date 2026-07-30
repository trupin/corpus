import type { DocPanelProps } from "@corpus/kit/plugin";
import type { ReactElement } from "react";
import { docSource, dueCount, isOverdue, openItems, readItems } from "../items.js";
import "./todos.css";

/**
 * The open/done stats panel — the **one core injection slot in v1** (SPEC.md
 * §10): a fixed region above the document body, in both the column reader and
 * focus mode, for doc types this plugin owns.
 *
 * **It derives and never stores.** Both counts are parsed from the same
 * document body the editor renders, so they update on exactly the invalidation
 * that updates the document and can never disagree with it. There is no state
 * here to go stale, and nothing to keep in sync.
 *
 * A document whose items cannot be read — a pre-PLUGINS-005 `extra.items` key
 * that was hand-edited into something unparseable — renders no panel at all:
 * a stats panel over an unreadable list would be a quiet claim about a broken
 * state the user cannot see from here.
 *
 * **The deadline chip carries the overdue treatment**, because SPEC.md §12 says
 * it applies wherever items are shown and this is the one surface that showed a
 * deadline count without it: a list with a passed deadline read exactly like a
 * list with a comfortable one, on the very screen the user opened to work on it.
 * It is one chip and one modifier class — the same `--signal` the row preview's
 * box and the column's date already use — and the label says which, so the
 * distinction is not carried by colour alone.
 */
export interface TodoDocPanelProps extends DocPanelProps {
  /** Injectable clock, so a test can pin the overdue boundary. */
  readonly now?: Date | undefined;
}

export function TodoDocPanel({ doc, now }: TodoDocPanelProps): ReactElement | null {
  const read = readItems(docSource(doc));
  if (!read.ok) return null;

  const today = now ?? new Date();
  const open = openItems(read.items).length;
  const done = read.items.length - open;
  const due = dueCount(read.items);
  const overdue = read.items.filter((item) => isOverdue(item, today)).length;
  const complete = read.items.length === 0 ? 0 : Math.round((done / read.items.length) * 100);

  return (
    <div className="doc-panel" data-todo-panel={doc.frontmatter.id}>
      <div className="stat">
        <b data-stat-open>{open}</b>
        <span>open</span>
      </div>
      <div className="stat">
        <b data-stat-done>{done}</b>
        <span>done</span>
      </div>
      <div
        className="todo-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={complete}
        aria-label={`${String(complete)}% complete`}
      >
        <span className="todo-progress-fill" style={{ width: `${String(complete)}%` }} />
      </div>
      {due === 0 ? null : (
        <span
          className={`chip todo-due-chip${overdue === 0 ? "" : " overdue"}`}
          data-todo-overdue={overdue}
        >
          {overdue === 0 ? `${String(due)} due` : `${String(due)} due · ${String(overdue)} overdue`}
        </span>
      )}
      <span className="chip plugin-tag">plugin: todos</span>
    </div>
  );
}
