import { useDoc } from "@corpus/kit";
import type { ReactElement } from "react";
import type { TodoItem } from "../items.js";
import { itemSelector, threadForItem, type ItemSelector } from "./itemAnchor.js";
import { PluginMenu, type PluginMenuAction } from "./PluginMenu.js";

/**
 * The quick actions a todo **item** has, as a context menu (PLUGINS-009).
 *
 * SPEC.md §10, as amended 2026-08-02, admits this menu on one condition: it
 * lists *"only the item's existing actions, nothing invented … and no exclusive
 * capability"*. All three are the item's, and all three stay reachable without
 * this menu — toggling is a checkbox in the reader, commenting is selecting the
 * item's words and pressing Comment, and the thread is a 💬 chip in the margin.
 * Nothing here is a fourth way to do a thing that has no other way.
 *
 * **One document read, taken when the menu opens.** Two of the three actions
 * need the parent's *body*: the comment's selector is a slice of it (§6), and
 * "does this item already have a thread" is a question about the resolved
 * anchors that ride the same read. The aggregate the column renders from
 * carries neither — `TodoListView` is `{docId, title, open, done, items}` — so
 * this component reads the document, and it does so here rather than in the
 * column precisely because a menu is open for one item at a time. Rendering
 * fifty rows costs zero document reads; opening a menu costs one, cached under
 * the kit's `["docs", id]` key like every other read of it.
 */

export interface TodoItemTarget {
  readonly docId: string;
  /** The list's title, for the menu's accessible name. */
  readonly listTitle: string;
  /** Index into the document's items, in body order — the plugin routes' index. */
  readonly index: number;
  readonly item: TodoItem;
}

export interface TodoItemMenuProps {
  readonly target: TodoItemTarget;
  readonly clientX: number;
  readonly clientY: number;
  readonly autoFocus?: boolean | undefined;
  /** Checks or unchecks the box, through the plugin's own item route. */
  readonly onToggle: (target: TodoItemTarget) => void;
  /** Opens the composer for a new thread anchored to this item. */
  readonly onComment: (target: TodoItemTarget, selector: ItemSelector) => void;
  /** Opens the parent document at the item's existing thread. */
  readonly onOpenThread: (target: TodoItemTarget, threadId: string) => void;
  readonly onClose: () => void;
}

export function TodoItemMenu({
  target,
  clientX,
  clientY,
  autoFocus,
  onToggle,
  onComment,
  onOpenThread,
  onClose,
}: TodoItemMenuProps): ReactElement {
  const doc = useDoc(target.docId);
  const body = doc.data?.body;
  const selector = body === undefined ? null : itemSelector(body, target.index, target.item.text);
  // The same body, index and label the selector is built from: an anchor is
  // this item's thread when it lands on this item's characters, and a namesake
  // three lines down is a different item with a different answer.
  const anchor =
    doc.data === undefined
      ? null
      : threadForItem(doc.data.anchors, doc.data.body, target.index, target.item.text);

  const actions: PluginMenuAction[] = [
    {
      id: "toggle",
      label: target.item.done ? "Mark as open" : "Mark as done",
      meta: target.item.done ? "unchecks the box in the list" : "checks the box in the list",
      run: () => {
        onToggle(target);
      },
    },
    {
      id: "comment",
      label: "Comment on item",
      /*
       * Disabled rather than absent while the read is in flight, and disabled
       * with a reason when the body cannot support a selector — an unmigrated
       * list, or an item that moved between the aggregate and the document.
       * Sending `{exact}` alone instead would anchor a comment to whichever
       * copy of the text the server found first (sprint-023 OC4), which is a
       * wrong anchor rather than a missing one.
       */
      disabled: selector === null,
      meta:
        doc.data === undefined
          ? "reading the document…"
          : selector === null
            ? "unavailable — this item is not in the document body"
            : "opens a thread anchored to these words",
      run: () => {
        if (selector !== null) onComment(target, selector);
      },
    },
  ];

  if (anchor !== null) {
    actions.push({
      id: "open-thread",
      label: "Open existing thread",
      meta: anchor.threadStatus === "resolved" ? "resolved — opens in the reader" : "in the reader",
      run: () => {
        onOpenThread(target, anchor.threadId);
      },
    });
  }

  return (
    <PluginMenu
      label={`Actions for ${target.item.text}`}
      clientX={clientX}
      clientY={clientY}
      autoFocus={autoFocus}
      actions={actions}
      onClose={onClose}
    />
  );
}
