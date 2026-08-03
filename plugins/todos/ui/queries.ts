import type { DocRow } from "@corpus/contract";
import { pluginKey, useDocs, usePluginQuery, type QueryKey } from "@corpus/kit";
import { z } from "zod";
import { TodoItemSchema, type TodoItem } from "../items.js";
import { TODO_DOC_TYPE, TODOS_PLUGIN } from "../shared.js";

/**
 * **Where the board's todo surfaces get their items** — the column and the list
 * row, through one request, kept live by two different invalidations.
 *
 * Until PLUGINS-005 this file did not exist as a read path: `extra` rides every
 * list row, so `itemsOrEmpty(row)` answered from the `useDocs` the board had
 * already issued. Items are body task-list lines now (SPEC.md §12), and
 * **bodies do not ride list rows** — only `excerpt` does. So the aggregate has
 * to come from the plugin's own `GET /lists` route, which already reports every
 * todo document with its items and its open/done counts.
 *
 * ### The live-update hole, and the fingerprint that closes it
 *
 * Two things can now change an item, and they announce themselves differently:
 *
 * - a **plugin write** (`corpus todos check`, a route call) broadcasts
 *   `[["lists"]]` → `["x","todos","lists"]` on the wire;
 * - a **core write** — which is the *ordinary* way to check a box since
 *   PLUGINS-006, because the editor owns the body — broadcasts `["docs"]` and
 *   never anything under `x/todos`.
 *
 * A query keyed only on `["x","todos","lists"]` therefore hears the first and
 * is deaf to the second: the column would show stale counts until a reload,
 * after the app's most ordinary interaction. The join is a **fingerprint** of
 * `(id, updated)` over `useDocs({type: "todo"})` — a query core *does*
 * invalidate — carried as a path segment, so:
 *
 * - a core body edit stamps `updated`, `["docs"]` refetches `useDocs`, the
 *   fingerprint changes, the key changes, and this query refetches;
 * - the key is still **prefixed** by `["x","todos","lists"]`, and TanStack's
 *   invalidation matches by prefix, so the plugin's own broadcast keeps working
 *   exactly as it did — the fingerprint is added beside the shipped path, never
 *   instead of it.
 *
 * The segment is a short hash rather than the raw pairs: a workspace with a
 * hundred todo documents would otherwise put kilobytes in a URL. The route
 * ignores it — it exists to be *different*, and `server/routes.ts` documents
 * that it is deliberately unread.
 *
 * Composed entirely at the call site through `usePluginQuery` and `useDocs`:
 * `packages/kit` is untouched (sprint-017 TEST-515).
 */

/**
 * The plugin's own read key, `["x","todos","lists"]` — the *only* one.
 *
 * There is deliberately no per-document key. The plugin publishes one query,
 * the aggregate, and a `["x","todos","lists",<docId>]` broadcast would name a
 * query nothing has ever registered: TanStack matches by prefix, and a document
 * id is not a prefix of `["x","todos","lists","at",<fingerprint>]`. It looked
 * like precision and invalidated nothing (CLEAN 43). One key, and every write
 * to any list refetches the one read every surface shares.
 */
export const TODO_LISTS_KEY: QueryKey = pluginKey(TODOS_PLUGIN, "lists");

/** One todo document, as `GET /api/x/todos/lists` reports it. */
const TodoListSchema = z.object({
  docId: z.string(),
  title: z.string(),
  open: z.number(),
  done: z.number(),
  items: z.array(TodoItemSchema),
});

const ListsSchema = z.object({ lists: z.array(TodoListSchema) });

export type TodoListView = z.infer<typeof TodoListSchema>;

/**
 * FNV-1a over the rows' `(id, updated)` pairs, base-36.
 *
 * Not a security boundary and not an identity — just a value that changes
 * whenever any todo document is written, short enough to live in a URL. The
 * plugin's own broadcast still covers writes through its routes, so even a
 * collision could only delay a refresh that another path already triggers.
 */
export function docsFingerprint(rows: readonly DocRow[]): string {
  let hash = 0x811c9dc5;
  for (const row of rows) {
    for (const char of `${row.id}:${row.updated ?? ""};`) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(36);
}

/** The aggregate's request path — the fingerprint is a cache generation, not an argument. */
export function listsPath(fingerprint: string): string {
  return `lists/at/${fingerprint}`;
}

export interface TodoLists {
  /** Every todo document with items, keyed by document id. */
  readonly byDoc: ReadonlyMap<string, TodoListView>;
  /** In the order the collection query returned them — the board's own order. */
  readonly all: readonly TodoListView[];
  /** True until both halves have answered once. */
  readonly loading: boolean;
  readonly error: Error | null;
  /**
   * Re-reads the aggregate now, and resolves when it has landed.
   *
   * The plugin's own write path already broadcasts `["lists"]` and the SSE
   * bridge turns that into this very invalidation — but only for a client whose
   * stream is up. A write made from the board should refresh the board it was
   * made from whether or not the stream is connected, which is the same reason
   * `useUpdateDoc` invalidates alongside the server's frame rather than instead
   * of it. Every todo surface shares this query key, so one refetch updates the
   * column and every document row's preview at once.
   */
  readonly refresh: () => Promise<void>;
}

const EMPTY: readonly TodoListView[] = [];

/**
 * The one read every todo board surface shares.
 *
 * Both callers use the same key, so TanStack dedupes them into a **single**
 * request no matter how many todo rows the board is rendering — the one-query
 * property the plugin had for free when items rode the list rows, bought back
 * deliberately.
 */
export function useTodoLists(): TodoLists {
  const docs = useDocs({ type: TODO_DOC_TYPE });
  const rows = docs.data?.items;
  const fingerprint = rows === undefined ? "" : docsFingerprint(rows);
  // Not until the fingerprint is real: fetching with a placeholder would issue
  // one request against a key nothing will ever invalidate, then another.
  const lists = usePluginQuery(TODOS_PLUGIN, listsPath(fingerprint), {
    enabled: rows !== undefined,
  });

  const parsed = lists.data === undefined ? null : ListsSchema.safeParse(lists.data);
  const all = parsed?.success === true ? parsed.data.lists : EMPTY;

  return {
    byDoc: new Map(all.map((list) => [list.docId, list])),
    all,
    refresh: async () => {
      await lists.refetch();
    },
    loading: rows === undefined || (lists.data === undefined && lists.error === null),
    error:
      docs.error ??
      lists.error ??
      (parsed !== null && !parsed.success
        ? new Error(`the todos route answered a shape this plugin does not understand`)
        : null),
  };
}

/** One document's items, or none while the aggregate is still loading. */
export function useTodoItems(docId: string): readonly TodoItem[] {
  const lists = useTodoLists();
  return lists.byDoc.get(docId)?.items ?? EMPTY_ITEMS;
}

const EMPTY_ITEMS: readonly TodoItem[] = [];
