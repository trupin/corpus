import { isUnreflected, type DocRow } from "@corpus/contract";
import { docsListKey, useCorpusClient, useDocs } from "@corpus/kit";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Board } from "../board/boardDoc";
import { VIEWS_FILTER } from "../board/useColumns";
import { toBoardColumn } from "../board/viewDoc";
import { useReflectStatus } from "./useReflectStatus";

/**
 * Which board tabs carry a dot — SPEC.md §7's *"a board tab carries a dot while
 * it holds any"* unreflected document.
 *
 * ## It costs nothing, and that is the constraint
 *
 * The issue is explicit: the dot is **derived from the rows already loaded,
 * never an extra request**. So this reads the query cache and does not fill it.
 * Every entry below is a `useQueries` observer with `enabled: false` — it
 * subscribes to a cache entry, re-renders when that entry changes, and never
 * issues a fetch of its own. An `invalidate` frame marks a disabled query stale
 * without refetching it, so a board nobody is looking at costs one cache lookup
 * and no network.
 *
 * The two inputs it does read are already on the page: `useBoards`' board
 * documents, and the single `type=view` query `useColumns` issues for the whole
 * bar (one request for every board, not one per board — see that module).
 *
 * ## What the absence of a dot means, and what it does not
 *
 * A dot appears where this browser **knows** there is something unreflected. It
 * does not appear where the rows have not been loaded — a board never visited in
 * this session — and that is a gap the surface is honest about rather than one
 * it papers over: the alternative is a request per column of every board on the
 * bar, on every load, to decorate a tab. The board being shown always has its
 * rows, so the case a person is looking at is always right, and the corpus-wide
 * number lives in the Reflect control beside the tabs.
 *
 * **A clock that has not arrived draws nothing.** `reflected: null` means
 * *never reflected*, under which every document in the corpus is unreflected —
 * so falling through to it while the status request is in flight would light
 * every tab on the bar for one round trip. The status has to have arrived
 * before anything is claimed.
 */
export function useChangedBoards(boards: readonly Board[]): ReadonlySet<string> {
  const status = useReflectStatus();
  const views = useDocs(VIEWS_FILTER);
  const client = useCorpusClient();
  const viewRows = views.data?.items;

  const byId = useMemo(
    () => new Map<string, DocRow>((viewRows ?? []).map((row) => [row.id, row])),
    [viewRows],
  );

  /**
   * The distinct column queries the whole bar resolves to, and which of them
   * each board is made of.
   *
   * Deduplicated because the same view may sit on two boards (rider 2), and two
   * boards sharing a column share its cache entry — so the observer is made
   * once and both tabs read the same answer.
   */
  const plan = useMemo(() => {
    const filters: Readonly<Record<string, string>>[] = [];
    const seen = new Map<string, number>();
    const slotsOf = new Map<string, number[]>();
    for (const board of boards) {
      const slots: number[] = [];
      for (const viewId of board.columnIds) {
        const row = byId.get(viewId);
        // A column whose view document is missing or unreadable queries nothing,
        // so there is nothing cached for it and nothing to say about it.
        if (row === undefined) continue;
        const column = toBoardColumn(viewId, row);
        if (column.error !== null) continue;
        const cacheKey = JSON.stringify(docsListKey(column.filter));
        let at = seen.get(cacheKey);
        if (at === undefined) {
          at = filters.length;
          seen.set(cacheKey, at);
          filters.push(column.filter);
        }
        slots.push(at);
      }
      slotsOf.set(board.id, slots);
    }
    return { filters, slotsOf };
  }, [boards, byId]);

  const cached = useQueries({
    queries: plan.filters.map((filter) => ({
      queryKey: docsListKey(filter),
      // Present so this observer is the same query the column itself runs — the
      // key and the function together are what make it one cache entry rather
      // than a lookalike. `enabled: false` is what keeps it from ever running.
      queryFn: ({ signal }: { signal: AbortSignal }) => client.listDocs(filter, { signal }),
      enabled: false,
    })),
  });

  const data = status.data;
  if (data === undefined) return new Set<string>();
  const reflected = data.reflected;

  const holdsAny = cached.map((entry) =>
    (entry.data?.items ?? []).some((row) => isUnreflected(row, reflected)),
  );

  const marked = new Set<string>();
  for (const [boardId, slots] of plan.slotsOf) {
    if (slots.some((slot) => holdsAny[slot] === true)) marked.add(boardId);
  }
  return marked;
}
