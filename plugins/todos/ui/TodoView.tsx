import { MarkdownView } from "@corpus/kit";
import type { DocViewProps } from "@corpus/kit/plugin";
import { useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { isOverdue, type TodoItem } from "../items.js";
import { useTodoWriter, type TodoWriter } from "./queries.js";
import "./todos.css";

/**
 * The `todo` document, rendered (SPEC.md §12): a checkbox list whose writes go
 * through this plugin's own server routes.
 *
 * A registered `View` **replaces** the standard document view for its type
 * (SPEC.md §10), so this component owns the whole body surface — which is also
 * why every failure mode has to degrade *here* rather than somewhere in core:
 *
 * - malformed `items` (hand-edited, or written by an older version) render a
 *   non-blocking notice **plus the raw markdown body**, so nothing is hidden
 *   and the document stays fixable — it never throws into the error boundary;
 * - a foreign edit lock (SPEC.md §7) makes the whole list read-only; the core
 *   lock banner is already on screen above this view and the plugin makes no
 *   attempt to bypass it;
 * - an empty (or absent — sprint-014 Adjudication 17) `items` key is an empty
 *   list with its add affordance, not an error.
 *
 * Markup and class names follow `design/index.html`'s `.check-list` treatment;
 * every colour, size and space comes from the kit's design tokens through
 * `todos.css`, so the list inherits Corpus theming in light and dark alike.
 */

interface TodoRowProps {
  readonly index: number;
  readonly item: TodoItem;
  readonly writer: TodoWriter;
  readonly today: Date;
}

function TodoRow({ index, item, writer, today }: TodoRowProps): ReactElement {
  const overdue = isOverdue(item, today);
  const className = ["check", item.done ? "done" : "", overdue ? "overdue" : ""]
    .filter((part) => part !== "")
    .join(" ");

  const commit = (value: string): void => {
    writer.rename(index, value);
  };

  return (
    <div className={className} data-todo-item={String(index)}>
      <button
        type="button"
        className="box"
        aria-pressed={item.done}
        aria-label={`${item.done ? "Uncheck" : "Check"} “${item.text}”`}
        disabled={writer.locked}
        onClick={() => {
          writer.toggle(index);
        }}
      >
        {item.done ? "☑" : "☐"}
      </button>
      {/*
       * An always-editable input rather than a click-to-edit swap: the label is
       * then reachable by keyboard, its text stays selectable, and there is no
       * second "editing" state to keep in sync with the server's. Keying it on
       * the item's own text is what makes an incoming change replace the field
       * rather than fight whatever is typed into it.
       */}
      <input
        key={`${String(index)}:${item.text}`}
        className="check-text"
        type="text"
        defaultValue={item.text}
        readOnly={writer.locked}
        aria-label={`Item ${String(index + 1)}`}
        onBlur={(event) => {
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = item.text;
            event.currentTarget.blur();
          }
        }}
      />
      {item.due === undefined ? null : (
        <span className="due" data-overdue={overdue ? "true" : "false"}>
          {item.due}
        </span>
      )}
      <button
        type="button"
        className="check-remove"
        aria-label={`Remove “${item.text}”`}
        disabled={writer.locked}
        onClick={() => {
          writer.remove(index);
        }}
      >
        ×
      </button>
    </div>
  );
}

export interface TodoViewProps extends DocViewProps {
  /** Injectable clock, so a test can pin the overdue boundary. */
  readonly now?: Date;
}

export function TodoView({ doc, now }: TodoViewProps): ReactElement {
  const writer = useTodoWriter(doc);
  const [draft, setDraft] = useState("");
  const today = now ?? new Date();

  if (writer.problems.length > 0) {
    return (
      <div className="todo-view">
        <div className="todo-notice" role="alert">
          <b>This list could not be read.</b> Its <code>items</code> frontmatter is malformed, so
          the checkbox list is not shown and nothing here will be written until it is fixed:
          <ul>
            {writer.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
        <MarkdownView markdown={doc.body} className="doc-body" />
      </div>
    );
  }

  const onAdd = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    writer.add(draft);
    setDraft("");
  };

  return (
    <div className="todo-view" data-todo-doc={doc.frontmatter.id}>
      {writer.error === null ? null : (
        <p className="todo-error" role="alert">
          {writer.error}
        </p>
      )}

      <div className="check-list">
        {writer.items.length === 0 ? (
          <p className="todo-empty">Nothing on this list yet.</p>
        ) : (
          writer.items.map((item, index) => (
            <TodoRow
              key={`${item.ts}:${item.text}`}
              index={index}
              item={item}
              writer={writer}
              today={today}
            />
          ))
        )}
      </div>

      <form className="todo-add" onSubmit={onAdd}>
        <input
          className="todo-add-text"
          type="text"
          value={draft}
          placeholder="Add an item…"
          aria-label="Add an item"
          disabled={writer.locked}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button type="submit" disabled={writer.locked || draft.trim() === ""}>
          Add
        </button>
      </form>
    </div>
  );
}
