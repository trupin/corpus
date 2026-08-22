import {
  AgentActivityDot,
  AgeChip,
  NeedsYouBadge,
  UnreadBadge,
  ageLabel,
  hasStaleActions,
  reasonChips,
  rowContext,
  stalenessClass,
  stalenessLevel,
  unreadBadgeProps,
  useAgentActivity,
  useRowActions,
} from "@corpus/kit";
import type { ListItemProps } from "@corpus/kit/plugin";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { dueCount, isOverdue } from "../items.js";
import { useTodoItems } from "./queries.js";
import "./todos.css";

/**
 * A `todo` document's row, in every column that lists one (SPEC.md §10, §10).
 *
 * A registered `ListItem` replaces the kit `Row` **wholesale** for its type, so
 * this component is responsible for everything a row owes the board — the
 * unread pill, the working dot, the attention reasons, the staleness ladder and
 * its quick actions — and adds the one thing only this plugin knows about:
 * `design/index.html`'s `.todo-items` preview and its due count. Dropping the
 * row's own signals to save code is how a whole document type quietly stops
 * showing that the agent is working on it.
 *
 * **There is no chip saying another writer holds this document, and there must
 * not be one.** SPEC.md §7 replaced the per-document lock with a key, so there
 * is nothing to hold; §10 is explicit that the board is never read-only, and a
 * chip announcing someone else's claim on a row is that banner in miniature.
 * The kit's `Row` draws no such chip either — this row matches it because both
 * follow the same sentence, not because one copied the other.
 *
 * Everything the *row* needs is derived from what the server already computed
 * on it, plus the one live signal the kit publishes as a hook
 * (`useAgentActivity`), backed by one shared query for the whole board.
 *
 * The **items** are the one thing a row cannot carry: they are body text since
 * PLUGINS-005 and bodies do not ride list rows. They come from
 * {@link useTodoItems}, which is the *same* shared aggregate the Todos column
 * reads — one query key, so ten todo rows on the board are still one request,
 * not ten. That is the property this preview had for free when items rode
 * `extra`, and it is the one worth paying to keep.
 */

/** The design's three-item preview: enough to recognise the list, never the list. */
const PREVIEW_ITEMS = 3;

export interface TodoListItemProps extends ListItemProps {
  /** Injectable clock, so a test can pin the age label and the overdue boundary. */
  readonly now?: Date | undefined;
}

export function TodoListItem(props: TodoListItemProps): ReactElement {
  const { row, onOpen, onNotify, unreadCount, now, showReasons, cursor } = props;

  const level = stalenessLevel(row.stale);
  const showActions = hasStaleActions(level);
  const actions = useRowActions(row, {
    ...(onNotify ? { onNotify } : {}),
    ...(now ? { now: () => now } : {}),
  });
  const activity = useAgentActivity(row);

  const today = now ?? new Date();
  const items = useTodoItems(row.id);
  const due = dueCount(items);
  const preview = items.slice(0, PREVIEW_ITEMS);
  const unread = unreadBadgeProps(row, unreadCount);
  const chips = showReasons === false ? [] : reasonChips(row.attention, row.stale);

  const open = (): void => {
    if (onOpen !== undefined) onOpen(row);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  };

  // A quick action must not also open the document.
  const swallow = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
  };

  const className = [
    "row",
    "todo-row",
    stalenessClass(level),
    actions.isLeaving ? "leaving" : "",
    cursor === true ? "kbd" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      data-row-doc={row.id}
      data-row-type={row.type}
      data-row-status={row.status}
      data-row-level={String(level)}
      aria-label={`${row.type}: ${row.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="row-top">
        <span className="type-glyph">{row.type}</span>
        <span className="row-title">{row.title}</span>
        <span className="row-badges">
          {unread === null ? null : <UnreadBadge {...unread} />}
          {due === 0 ? null : <NeedsYouBadge text={`${String(due)} due`} />}
          <AgentActivityDot activity={activity} />
          {showActions ? <AgeChip label={ageLabel(row, today)} /> : null}
        </span>
      </div>

      {preview.length === 0 ? null : (
        <div className="todo-items">
          {preview.map((item, index) => (
            <div
              key={`${String(index)}:${item.text}`}
              className={["t", item.done ? "done" : "", isOverdue(item, today) ? "overdue" : ""]
                .filter((part) => part !== "")
                .join(" ")}
            >
              <span className="box">{item.done ? "☑" : "☐"}</span>
              <span className="todo-item-text">{item.text}</span>
            </div>
          ))}
          {items.length > preview.length ? (
            <div className="t todo-more">+{items.length - preview.length} more</div>
          ) : null}
        </div>
      )}

      {chips.length === 0 ? null : (
        <div className="reason">
          {chips.map((chip) => (
            <span
              key={chip.code}
              className={`r-chip ${chip.chipClass}`.trimEnd()}
              data-reason={chip.code}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {showActions ? (
        <div className="stale-actions" onClick={swallow} onKeyDown={swallow} role="presentation">
          <button
            type="button"
            data-act="archive"
            disabled={actions.isBusy}
            onClick={actions.archive}
          >
            Archive
          </button>
          <button
            type="button"
            className="keep"
            data-act="keep"
            disabled={actions.isBusy}
            onClick={actions.stillCurrent}
          >
            Still current
          </button>
          <button
            type="button"
            className="keep"
            data-act="triage"
            disabled={actions.isBusy}
            onClick={actions.triage}
          >
            @agent triage
          </button>
        </div>
      ) : (
        <div className="row-meta">
          <span className="row-context">{rowContext(row) ?? ""}</span>
          <AgeChip label={ageLabel(row, today)} />
        </div>
      )}

      {actions.error === null ? null : (
        <p className="row-error" role="alert">
          {actions.error.message}
        </p>
      )}
    </div>
  );
}
