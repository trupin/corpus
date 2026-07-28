import type { DocList, DocRow } from "@corpus/contract";
import { useDocs } from "@corpus/kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { toApiParams, type SearchApiParams, type SearchQuery } from "./searchQuery";

/**
 * The overlay's data path: one debounced `GET /api/docs` per query, and nothing
 * else (SPEC.md §11).
 *
 * Two properties this hook exists to guarantee, both of which are acceptance
 * criteria rather than optimisations:
 *
 * 1. **One request per burst.** Keystrokes coalesce into a single request per
 *    debounce window, so typing "mortgage" issues one query and not eight.
 * 2. **No second request per group.** The Documents and Threads groups are
 *    partitions of *this* response. Nothing here fetches twice, and nothing
 *    downstream filters the returned set — the rows rendered are the rows the
 *    server chose.
 *
 * Out-of-order responses need no handling: the request is keyed by its own
 * canonicalised filter, so a slow answer to a query the user has moved past
 * lands in that query's cache entry and is never rendered as the current one.
 */

/** The prototype's feel: fast enough to be live, slow enough to coalesce. */
export const SEARCH_DEBOUNCE_MS = 200;

export interface SearchResults {
  /** Exactly what the outstanding request carries — quoted by the tests. */
  readonly params: SearchApiParams;
  readonly items: readonly DocRow[];
  /** The server's count for the whole result set, not this page's length. */
  readonly total: number;
  /** True before any result set has arrived, never between refreshes. */
  readonly isPending: boolean;
  /** True while a keystroke is still inside the debounce window. */
  readonly isDebouncing: boolean;
  readonly error: Error | null;
}

export function useSearch(query: SearchQuery, debounceMs = SEARCH_DEBOUNCE_MS): SearchResults {
  const params = useMemo(() => toApiParams(query), [query]);
  // The serialization, not the object: `toApiParams` emits its keys in a fixed
  // order, so identical searches produce an identical string and a re-render
  // that changes nothing restarts no timer.
  const key = useMemo(() => JSON.stringify(params), [params]);

  const [settled, setSettled] = useState<{ key: string; params: SearchApiParams }>(() => ({
    key,
    params,
  }));

  useEffect(() => {
    if (key === settled.key) return undefined;
    const timer = setTimeout(() => {
      setSettled({ key, params });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [debounceMs, key, params, settled.key]);

  const docs = useDocs(settled.params);

  /**
   * The last result set that actually arrived, held across a query change.
   *
   * TanStack drops to `undefined` on a new key, which would blank the list on
   * every keystroke and make the panel jump. This is presentation only — the
   * rows shown are always a set the server returned, never a filtered or merged
   * one — and it is replaced the instant the new response lands.
   */
  const previous = useRef<DocList | null>(null);
  if (docs.data !== undefined) previous.current = docs.data;
  const data = docs.data ?? previous.current;

  return {
    params: settled.params,
    items: data?.items ?? [],
    total: data?.page.total ?? 0,
    isPending: docs.isPending && previous.current === null,
    isDebouncing: key !== settled.key,
    error: docs.error,
  };
}
