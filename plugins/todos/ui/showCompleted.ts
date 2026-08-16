import { useCallback, useState } from "react";

/**
 * "Also show completed items", per Todos column — **browser-local**, never the
 * view document (SPEC.md §12, rider signed 2026-08-12).
 *
 * The rider draws the line explicitly: the column shows open items by default,
 * offers a control that also shows completed ones, and *"the default is
 * unchanged by looking at them"*. So this is the same kind of state as a scroll
 * offset or which document a column has open — it belongs to this browser and
 * to nobody else, and writing it into the column's `view` document would
 * auto-commit a glance and change what a second browser sees.
 *
 * The stored shape is the **set of columns that are showing completed items**,
 * so the default costs no entry at all: turning the control off removes the id
 * rather than storing `false`, and a workspace nobody has touched writes
 * nothing. A blob from a future version, or one that will not parse, degrades
 * to the default instead of being repaired — the cost is one lost preference,
 * and the alternative is guessing at a shape.
 *
 * The plugin holds its own key rather than joining `corpus.board`: that blob is
 * `apps/ui`'s, versioned by core, and a plugin writing into it would be reaching
 * across the same boundary the kit-only import rule exists to prevent.
 */

export const TODOS_STORAGE_KEY = "corpus.x.todos";

/** Bumped when the shape below changes; an older blob degrades to defaults. */
export const TODOS_STATE_VERSION = 1;

/**
 * The ambient store, or `null` where there is none to speak of.
 *
 * Taken as a parameter everywhere below rather than reached for inside, because
 * the ambient `localStorage` under a test runner is not dependable — Node 25
 * defines its own Web Storage global that shadows jsdom's and is inert.
 */
export function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and sandboxed frames throw on the property itself.
    return null;
  }
}

/** The column ids currently showing completed items, or none for anything unreadable. */
export function readShowCompleted(store: Storage | null = storageOrNull()): ReadonlySet<string> {
  let raw: string | null;
  try {
    raw = store?.getItem(TODOS_STORAGE_KEY) ?? null;
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Set();
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== TODOS_STATE_VERSION) return new Set();
    const ids = record["showCompleted"];
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/** Records — or clears — one column's choice, leaving every other column alone. */
export function writeShowCompleted(
  viewDocId: string,
  shown: boolean,
  store: Storage | null = storageOrNull(),
): void {
  if (store === null) return;
  const ids = new Set(readShowCompleted(store));
  if (shown) ids.add(viewDocId);
  else ids.delete(viewDocId);
  try {
    store.setItem(
      TODOS_STORAGE_KEY,
      JSON.stringify({ version: TODOS_STATE_VERSION, showCompleted: [...ids] }),
    );
  } catch {
    // A full or blocked quota loses the preference for this session. The column
    // still works; refusing to render because a nicety could not be saved would
    // be the worse failure.
  }
}

export interface ShowCompleted {
  readonly shown: boolean;
  readonly setShown: (next: boolean) => void;
}

/** One column's "also show completed" choice, read once and persisted on change. */
export function useShowCompleted(viewDocId: string): ShowCompleted {
  const [shown, setLocal] = useState(() => readShowCompleted().has(viewDocId));
  const setShown = useCallback(
    (next: boolean) => {
      writeShowCompleted(viewDocId, next);
      setLocal(next);
    },
    [viewDocId],
  );
  return { shown, setShown };
}
