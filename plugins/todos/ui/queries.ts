import type { Doc } from "@corpus/contract";
import { pluginKey, useCorpusClient, useDoc, useDocLock, type QueryKey } from "@corpus/kit";
import { useState } from "react";
import { itemsOrEmpty, readItems, type TodoItem } from "../items.js";
import { TODOS_PLUGIN } from "../shared.js";

/**
 * The todo document's write path, and the optimistic overlay that makes a
 * checkbox feel like a checkbox.
 *
 * **Reads come from the document itself.** `items` already arrived, parsed, in
 * the document's `extra` frontmatter — on the single read *and* on every list
 * row (`@corpus/contract`'s `extra` rides `docRowBaseShape`), which is what
 * lets the aggregate column be one query. Adding a second read of the same
 * state through the plugin's own routes would be a second source of truth that
 * could disagree with the list the user is looking at.
 *
 * **Writes go to the plugin's routes** through the kit's `pluginRequest` — the
 * one transport a plugin is given, so the bearer token, the base URL and the
 * error type are the kit's rather than re-implemented here. Every write lands
 * on the core write path server-side (git auto-commit, projection, SSE), and
 * the core `["docs"]` invalidation it broadcasts is what refreshes this
 * document with no plugin machinery at all.
 *
 * The overlay in between is deliberately small: the mutated array, plus the
 * snapshot it was derived from. When the server's version arrives the snapshot
 * no longer matches and the overlay is dropped in the same render — so a
 * reconciliation can never be missed, and no effect has to remember to clear it.
 */

/** The plugin's own read key, `["x","todos","lists"]` — see {@link TODO_LISTS_KEY}. */
export const TODO_LISTS_KEY: QueryKey = pluginKey(TODOS_PLUGIN, "lists");

/** `["x","todos","lists",<docId>]` — what a write on one list announces. */
export function todoListKey(docId: string): QueryKey {
  return pluginKey(TODOS_PLUGIN, "lists", docId);
}

/** A stable identity for a list of items — the overlay's reconciliation trigger. */
function snapshot(items: readonly TodoItem[]): string {
  return JSON.stringify(items);
}

export interface TodoWriter {
  /** The items to render: the optimistic overlay when one is live, else the document's. */
  readonly items: readonly TodoItem[];
  /** Problems reading `items`; empty when the frontmatter is well-formed. */
  readonly problems: readonly string[];
  /** True while a write is in flight — the list stays interactive, not frozen. */
  readonly busy: boolean;
  /** The last write failure, shown in place; cleared by the next attempt. */
  readonly error: string | null;
  /**
   * True when the *other* party holds this document's edit lock (SPEC.md §7).
   * The plugin renders read-only and does not attempt to bypass it; the core
   * lock banner is already on screen above this view.
   */
  readonly locked: boolean;
  readonly toggle: (index: number) => void;
  readonly rename: (index: number, text: string) => void;
  readonly add: (text: string) => void;
  readonly remove: (index: number) => void;
}

interface Overlay {
  readonly base: string;
  readonly items: readonly TodoItem[];
}

/**
 * The error text a failed write should show. A `409` is the one case the user
 * has to act on — someone else changed the item — so its message is the
 * server's own, verbatim.
 */
function failureText(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "The change could not be saved.";
}

export function useTodoWriter(doc: Doc): TodoWriter {
  const client = useCorpusClient();
  const lock = useDocLock(doc.frontmatter.id);
  // The same cache entry the reader already holds (`["docs", id]`), so a
  // refetch after a refused write puts the *server's* truth on screen rather
  // than leaving the caller looking at what it hoped would happen.
  const live = useDoc(doc.frontmatter.id);
  const read = readItems(doc.frontmatter);
  const stored = itemsOrEmpty(doc.frontmatter);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = snapshot(stored);
  // A stale overlay evaporates the moment the server's version differs from the
  // one it was built on — no effect, no cleanup, no window where both are live.
  const items = overlay !== null && overlay.base === base ? overlay.items : stored;

  const send = (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body: Record<string, unknown>,
    optimistic: readonly TodoItem[] | null,
  ): void => {
    if (optimistic !== null) setOverlay({ base, items: optimistic });
    setBusy(true);
    setError(null);
    void client
      .pluginRequest(TODOS_PLUGIN, path, { method, body })
      .catch((failure: unknown) => {
        // Never a silent overwrite: the optimistic state is dropped, the
        // document is refetched, and the reason is shown where the user is
        // looking. The refetch is what turns a 409 into the truth on screen.
        setOverlay(null);
        setError(failureText(failure));
        void live.refetch();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const locked = lock !== null && lock.holder !== "user";

  const guard = (run: () => void): void => {
    if (locked) return;
    run();
  };

  return {
    items,
    problems: read.ok ? [] : read.problems,
    busy,
    error,
    locked,
    toggle: (index) =>
      guard(() => {
        const item = items[index];
        if (item === undefined) return;
        send(
          `${doc.frontmatter.id}/items/${String(index)}`,
          "PUT",
          { done: !item.done, expectedText: item.text },
          items.map((current, at) =>
            at === index ? { ...current, done: !current.done } : current,
          ),
        );
      }),
    rename: (index, text) =>
      guard(() => {
        const item = items[index];
        if (item === undefined || text.trim() === "" || text === item.text) return;
        send(
          `${doc.frontmatter.id}/items/${String(index)}`,
          "PUT",
          { text, expectedText: item.text },
          items.map((current, at) => (at === index ? { ...current, text } : current)),
        );
      }),
    add: (text) =>
      guard(() => {
        if (text.trim() === "") return;
        // No optimistic append: `ts` is the server's clock, and inventing one
        // here would show an item whose creation time is about to change.
        send(`${doc.frontmatter.id}/items`, "POST", { text }, null);
      }),
    remove: (index) =>
      guard(() => {
        const item = items[index];
        if (item === undefined) return;
        send(
          `${doc.frontmatter.id}/items/${String(index)}`,
          "DELETE",
          { expectedText: item.text },
          items.filter((_current, at) => at !== index),
        );
      }),
  };
}
