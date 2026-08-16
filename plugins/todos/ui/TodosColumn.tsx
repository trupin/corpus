import type { ColumnComponentProps } from "@corpus/kit/plugin";
import { useState, type KeyboardEvent, type ReactElement } from "react";
import { isOverdue, type TodoItem } from "../items.js";
import { useTodoItemToggle } from "./itemActions.js";
import type { ItemSelector } from "./itemAnchor.js";
import { useTodoLists, type TodoListView } from "./queries.js";
import { itemOpenRequest } from "./reveal.js";
import { useShowCompleted } from "./showCompleted.js";
import { TodoItemComposer } from "./TodoItemComposer.js";
import { TodoItemMenu, type TodoItemTarget } from "./TodoItemMenu.js";
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
 * **One query, no N+1** — still, though it is no longer free. Items live in the
 * document body since PLUGINS-005 and bodies do not ride list rows, so the
 * aggregate comes from the plugin's own `GET /lists` route through
 * {@link useTodoLists}: one request for the whole board, shared with every
 * `TodoListItem` on screen because they read the same query key. The
 * `(id, updated)` fingerprint in that key is what keeps it live after a **core**
 * body edit — the ordinary way to check a box now — while the plugin's own
 * broadcast keeps working for its own writes. `ui/queries.ts` has the full
 * argument.
 *
 * **Archived documents are excluded** because the default result set excludes
 * them (SPEC.md §11); the column states no `status` and therefore inherits
 * core's answer rather than inventing a second one.
 *
 * **A click on an item names the item** (PLUGINS-010): the open carries UI-037's
 * reveal, so the reader opens scrolled to that line and flashes it, rather than
 * at the top of a list the user then has to search. The payload is built in
 * `./reveal.ts` from the document's *whole* item list — which is why the groups
 * below carry `all` beside the items they render.
 *
 * **The box checks the item; the rest of the row opens it** (PLUGINS-015). A row
 * is therefore a *container* holding two controls rather than one button — a
 * `<button>` inside a `<button>` is invalid and does not behave — and the two
 * tile it edge to edge, because padding belonging to neither reads as a row that
 * ignored the click. The box is a real `role="checkbox"`, so the keyboard and
 * assistive technology get its semantics rather than an approximation of them;
 * only the glyph is the plugin's. It writes through the same
 * {@link useTodoItemToggle} the item menu already used — this widened where a
 * toggle can be asked for and added no second write path — and the row leaves
 * the column because the aggregate refetched, never because the column guessed
 * locally at what the server would say.
 *
 * **And completed items are reachable, so unchecking is** (SPEC.md §12, rider
 * signed 2026-08-12): the column shows open items by default and offers a
 * control that also shows completed ones, held in `./showCompleted.ts` as
 * browser-local state. The control renders above the empty state too, which is
 * the case that matters most — a list whose last item was checked by mistake
 * shows no rows at all, and a control that only appeared beside rows would be
 * missing exactly then.
 *
 * **Right-click is the plugin's own** (PLUGINS-009). Core deliberately leaves
 * this surface alone — `Column.tsx` stamps `data-plugin-surface` on the node
 * above these rows, which is exactly where every core menu rule bails — so a
 * plugin row that wants a menu has to open one, and SPEC.md §11's 2026-08-02
 * amendment is what permits it. `TodoItemMenu` holds what is in it and why
 * nothing else is; the *writes* it triggers live here, in the component that
 * outlives the menu (`itemActions.ts`).
 */

/** Wide content belongs in focus mode (SPEC.md §10) — the column body stays narrow. */
const MAX_ITEMS_PER_LIST = 5;

/** One shown item, and where it sits among **all** of its document's items. */
interface ShownItem {
  /** Its position in {@link TodoGroup.all} — what a reveal's frame is read from. */
  readonly at: number;
  readonly item: TodoItem;
}

interface TodoGroup {
  readonly docId: string;
  readonly title: string;
  /**
   * Every item the document has, in body order, done ones included.
   *
   * The column may be showing only the open ones, but a reveal frames its target
   * with the lines the *reader* will render around it (PLUGINS-010) — and a
   * checked item between two open ones is one of those lines. Framing with the
   * shown items alone would quote a neighbour that is not adjacent on screen,
   * and the frame would never match.
   */
  readonly all: readonly TodoItem[];
  readonly items: readonly ShownItem[];
}

/**
 * Items grouped by their source document, empty lists dropped.
 *
 * `showCompleted` is the rider's control: off, this is the open items and
 * nothing else — a list of work to do; on, it is every item in body order, so a
 * box ticked by mistake is reachable to untick. Either way `at` is the item's
 * index in the **document**, which is what the plugin's item route addresses and
 * what a reveal's frame is read from — never its position on screen.
 */
export function groupItems(
  lists: readonly TodoListView[],
  showCompleted: boolean,
): readonly TodoGroup[] {
  const groups: TodoGroup[] = [];
  for (const list of lists) {
    const shown = list.items.flatMap((item, at) =>
      showCompleted || !item.done ? [{ at, item }] : [],
    );
    if (shown.length === 0) continue;
    groups.push({ docId: list.docId, title: list.title, all: list.items, items: shown });
  }
  return groups;
}

/** Which item's menu is open, and where it was opened from. */
interface OpenMenu {
  readonly target: TodoItemTarget;
  readonly clientX: number;
  readonly clientY: number;
  readonly autoFocus: boolean;
}

/** An item whose comment composer is open, with the selector it will anchor to. */
interface OpenComposer {
  readonly target: TodoItemTarget;
  readonly selector: ItemSelector;
  readonly clientX: number;
  readonly clientY: number;
}

export interface TodosColumnProps extends ColumnComponentProps {
  /** Injectable clock, so a test can pin the overdue boundary. */
  readonly now?: Date | undefined;
}

export function TodosColumn({ viewDocId, onOpen, now }: TodosColumnProps): ReactElement {
  // Deliberately the plugin's own aggregate rather than the view document's
  // query: this column *is* "open todo items", and a stored filter that
  // excluded `type: todo` would leave the component rendering nothing it can
  // explain. The `type: todo` collection query is still in there — it is what
  // the fingerprint is taken from (`ui/queries.ts`).
  const lists = useTodoLists();
  const toggle = useTodoItemToggle();
  const completed = useShowCompleted(viewDocId);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [composer, setComposer] = useState<OpenComposer | null>(null);
  const today = now ?? new Date();

  if (lists.error !== null) {
    return (
      <div className="col-card col-card-error" role="alert" data-todos-column={viewDocId}>
        Todos could not be loaded: {lists.error.message}
      </div>
    );
  }
  if (lists.loading) {
    return (
      <p className="col-empty" data-todos-column={viewDocId}>
        Loading…
      </p>
    );
  }

  const groups = groupItems(lists.all, completed.shown);

  const openMenu = (
    target: TodoItemTarget,
    clientX: number,
    clientY: number,
    autoFocus: boolean,
  ): void => {
    setComposer(null);
    setMenu({ target, clientX, clientY, autoFocus });
  };

  /** The menu key and ⇧F10, on the row the keyboard is on (SPEC.md §11). */
  const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, target: TodoItemTarget): void => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    // Also stops the board's own `menu.open` shortcut: its dispatcher skips an
    // already-defaulted event, which is how a surface says "this press was
    // mine" — and the board would otherwise refuse it anyway, because a plugin
    // row is one of the elements its keyboard path bails on.
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(target, rect.left + 16, rect.bottom - 8, true);
  };

  return (
    <div className="todos-column" data-todos-column={viewDocId}>
      {toggle.error === null ? null : (
        <p className="todos-error" role="alert">
          {toggle.error}
          <button type="button" className="todos-error-dismiss" onClick={toggle.dismiss}>
            Dismiss
          </button>
        </p>
      )}

      {/*
       * Rendered whatever the column holds, including nothing — the list whose
       * last item was just ticked shows no rows, and that is exactly when the
       * way back to it must be on screen. It is a toggle rather than a filter
       * menu because there are two states and naming them is the whole control.
       */}
      <div className="todos-bar">
        <button
          type="button"
          className="todos-show-done"
          aria-pressed={completed.shown}
          data-todos-show-completed={completed.shown ? "true" : "false"}
          onClick={() => {
            completed.setShown(!completed.shown);
          }}
        >
          {completed.shown ? "Hide completed" : "Show completed"}
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="col-empty">
          {completed.shown
            ? "No todo items anywhere yet."
            : "Nothing open. Every todo list is clear."}
        </p>
      ) : null}

      {groups.map((group) => (
        <section className="todos-group" key={group.docId} data-todos-group={group.docId}>
          {/*
           * The heading names the *document*, so it opens the document — at the
           * top, the way it always has. Only a click that named a line asks to
           * land on one (PLUGINS-010); "+N more" is the same, it is a click on
           * the rest of the list rather than on any item of it.
           */}
          <button type="button" className="todos-group-head" onClick={() => onOpen?.(group.docId)}>
            <span className="todos-group-title">{group.title}</span>
            <span className="todos-group-count">{group.items.length}</span>
          </button>
          <div className="check-list">
            {group.items.slice(0, MAX_ITEMS_PER_LIST).map(({ at, item }) => {
              const target: TodoItemTarget = {
                docId: group.docId,
                listTitle: group.title,
                index: at,
                item,
              };
              return (
                <div
                  key={`${String(at)}:${item.text}`}
                  className={`check${item.done ? " done" : ""}${
                    isOverdue(item, today) ? " overdue" : ""
                  }`}
                  data-todos-item={String(at)}
                  data-todos-done={item.done ? "true" : "false"}
                  onContextMenu={(event) => {
                    // The browser's menu is what this surface gets otherwise
                    // (`nativeMenu.ts` keeps it for every `[data-plugin-surface]`),
                    // so taking it is this issue's whole act — refused here, by
                    // the plugin, rather than by core.
                    event.preventDefault();
                    openMenu(target, event.clientX, event.clientY, false);
                  }}
                  onKeyDown={(event) => {
                    onItemKeyDown(event, target);
                  }}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.done}
                    className="box"
                    data-todos-check={String(at)}
                    // Named for what pressing it does, because a checkbox on a
                    // board of many lists is otherwise announced as "checkbox"
                    // and nothing else.
                    aria-label={`${item.done ? "Mark as open" : "Mark as done"}: ${item.text}`}
                    onClick={() => {
                      toggle.toggle(target);
                    }}
                  >
                    {item.done ? "☑" : "☐"}
                  </button>
                  <button
                    type="button"
                    className="todo-item-open"
                    onClick={() => onOpen?.(itemOpenRequest(group.docId, group.all, at))}
                  >
                    <span className="todo-item-text">{item.text}</span>
                    {item.due === undefined ? null : (
                      <span
                        className="due"
                        data-overdue={isOverdue(item, today) ? "true" : "false"}
                      >
                        {item.due}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
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

      {menu === null ? null : (
        <TodoItemMenu
          target={menu.target}
          clientX={menu.clientX}
          clientY={menu.clientY}
          autoFocus={menu.autoFocus}
          onToggle={toggle.toggle}
          onComment={(target, selector) => {
            setComposer({ target, selector, clientX: menu.clientX, clientY: menu.clientY });
          }}
          onOpenThread={(target, threadId) => {
            onOpen?.({ docId: target.docId, reveal: { kind: "thread", threadId } });
          }}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}

      {composer === null ? null : (
        <TodoItemComposer
          target={composer.target}
          selector={composer.selector}
          clientX={composer.clientX}
          clientY={composer.clientY}
          onCreated={(target, threadId) => {
            setComposer(null);
            // Straight to the comment that was just made: this column shows
            // items and never threads, so without this the only feedback for a
            // posted comment would be the popover disappearing.
            onOpen?.({ docId: target.docId, reveal: { kind: "thread", threadId } });
          }}
          onClose={() => {
            setComposer(null);
          }}
        />
      )}
    </div>
  );
}
