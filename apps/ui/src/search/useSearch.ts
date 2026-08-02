import type { SearchHit } from "@corpus/contract";
import { useCorpusSearch, type SearchParams } from "@corpus/kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { toSearchParams } from "./searchApi";
import type { SearchQuery } from "./searchQuery";

/**
 * The overlay's data path: one debounced `GET /api/search` per query, and
 * nothing else (SPEC.md §11 — "its ranked result list is served by
 * `GET /api/search`").
 *
 * Three properties this hook exists to guarantee, all of which are acceptance
 * criteria rather than optimisations:
 *
 * 1. **One request per burst.** Keystrokes coalesce into a single request per
 *    debounce window, so typing "mortgage" issues one query and not eight.
 * 2. **No second request per group.** The Documents and Threads groups are
 *    partitions of *this* response. Nothing here fetches twice, and nothing
 *    downstream filters the returned set — the rows rendered are the rows the
 *    server ranked, in the order the server ranked them.
 * 3. **The list never blanks mid-typing.** The last arrived hits are held across
 *    a query change, so the panel does not flash empty between keystrokes.
 *
 * Out-of-order responses need no handling: the request is keyed by its own
 * canonicalised filter, so a slow answer to a query the user has moved past
 * lands in that query's cache entry and is never rendered as the current one.
 *
 * **"Save as view" does not come through here.** It serializes the same
 * {@link SearchQuery} down the `GET /api/docs` path it always has — see
 * `searchApi.ts` for why the two serializers are forked and must stay so.
 */

/** The prototype's feel: fast enough to be live, slow enough to coalesce. */
export const SEARCH_DEBOUNCE_MS = 200;

export interface SearchState {
  /** Exactly what the outstanding request carries, or `undefined` for none. */
  readonly params: SearchParams | undefined;
  /** The server's ranking, in the server's order — never re-sorted here. */
  readonly hits: readonly SearchHit[];
  /**
   * How caught up the semantic half of ranking is (SPEC.md §9.1), straight off
   * the envelope. `undefined` means the server made no claim.
   */
  readonly semanticIndex: string | undefined;
  /** True before any result set has arrived, never between refreshes. */
  readonly isPending: boolean;
  /** True while a keystroke is still inside the debounce window. */
  readonly isDebouncing: boolean;
  /** True when there is no query to rank — an open overlay with nothing typed. */
  readonly isIdle: boolean;
  readonly error: Error | null;
}

const NO_HITS: readonly SearchHit[] = [];

export function useSearch(query: SearchQuery, debounceMs = SEARCH_DEBOUNCE_MS): SearchState {
  const params = useMemo(() => toSearchParams(query), [query]);
  // The serialization, not the object: `toSearchParams` emits its keys in a
  // fixed order, so identical searches produce an identical string and a
  // re-render that changes nothing restarts no timer. `null` stands for "no
  // query", which is a settleable state like any other.
  const key = useMemo(() => JSON.stringify(params ?? null), [params]);

  const [settled, setSettled] = useState<{ key: string; params: SearchParams | undefined }>(() => ({
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

  const search = useCorpusSearch(settled.params);

  /**
   * The last result set that actually arrived, held across a query change.
   *
   * TanStack drops to `undefined` on a new key, which would blank the list on
   * every keystroke and make the panel jump. This is presentation only — the
   * rows shown are always a set the server ranked, never a filtered or merged
   * one — and it is replaced the instant the new response lands.
   *
   * Clearing the input is the one case that must *not* hold: with no `q` there
   * is no request and no ranking, so keeping the previous hits on screen would
   * be showing the ranking of a query nobody is typing any more.
   */
  const previous = useRef<{
    readonly hits: readonly SearchHit[];
    readonly semanticIndex?: string | undefined;
  } | null>(null);
  const isIdle = settled.params === undefined;
  if (isIdle) previous.current = null;
  else if (search.data !== undefined) previous.current = search.data;
  const data = search.data ?? previous.current;

  return {
    params: settled.params,
    hits: isIdle ? NO_HITS : (data?.hits ?? NO_HITS),
    semanticIndex: isIdle ? undefined : data?.semanticIndex,
    isPending: !isIdle && search.isPending && previous.current === null,
    isDebouncing: key !== settled.key,
    isIdle,
    error: isIdle ? null : search.error,
  };
}
