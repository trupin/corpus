import { useCorpusClient } from "@corpus/kit";
import { useState } from "react";
import { TODOS_PLUGIN } from "../shared.js";
import { useTodoLists } from "./queries.js";
import type { TodoItemTarget } from "./TodoItemMenu.js";

/**
 * Checking a box from a board row — the plugin's own atomic item write
 * (PLUGINS-004), not a body edit.
 *
 * The distinction is the whole reason this goes through `PUT
 * /api/x/todos/{docId}/items/{index}` rather than through the kit's document
 * write: the route rewrites **one line** inside the document's write lane,
 * carrying `expectedText` as its guard. A body patch composed here would have
 * to send the whole body, computed from an aggregate read taken some time ago,
 * and would quietly revert anything the editor, the agent or another browser
 * wrote in between (`server/routes.ts`'s `mutateItems` documents the
 * interleaving). The board holds a *row*; the row's index and its label are
 * exactly what the route needs to refuse the write when the list has moved.
 *
 * The hook lives beside the column rather than inside the menu because a menu
 * closes the instant an item is chosen: a request owned by an unmounting
 * component reports its refusal to nobody.
 */

export interface TodoItemToggle {
  /** Flips one item's box. Never throws — a refusal lands in {@link error}. */
  readonly toggle: (target: TodoItemTarget) => void;
  /**
   * True while a write is in flight — a **progress** signal, not a lock, and
   * deliberately not gated on by the column.
   *
   * A second click during the first write cannot do damage: the payload states
   * the value it wants rather than an increment (`done: !item.done`, read off
   * the row the user is looking at), so repeating it re-applies the same value,
   * and it carries `expectedText`, so a list that moved underneath is refused
   * with a 409 instead of flipping whatever took the index. A guard here would
   * buy nothing and would cost the honest case — the user who clicks two
   * different rows quickly, which is two independent writes.
   */
  readonly busy: boolean;
  /** The last refusal, in the server's own words, until it is dismissed. */
  readonly error: string | null;
  readonly dismiss: () => void;
}

export function useTodoItemToggle(): TodoItemToggle {
  const client = useCorpusClient();
  const lists = useTodoLists();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    busy,
    error,
    dismiss: () => {
      setError(null);
    },
    toggle: (target) => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          await client.pluginRequest(
            TODOS_PLUGIN,
            `${target.docId}/items/${String(target.index)}`,
            {
              method: "PUT",
              body: { done: !target.item.done, expectedText: target.item.text },
            },
          );
          await lists.refresh();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
        }
      })();
    },
  };
}
