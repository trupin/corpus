import { QueryClient } from "@tanstack/react-query";

/**
 * Query defaults for an SSE-invalidated cache (SPEC.md §11, "Live updates").
 *
 * The server pushes `invalidate` events carrying query keys; the kit's bridge
 * turns those into invalidations. That makes every form of *guessing* about
 * freshness wrong — and actively harmful, because a poll can overwrite a value
 * the user is mid-edit on:
 *
 *  - `staleTime: Infinity` — data is fresh until the server says otherwise.
 *  - `refetchOnWindowFocus`/`refetchOnReconnect: false` — refocusing a tab is
 *    not evidence of a change, and reconnect is handled where it belongs: the
 *    SSE bridge refetches active queries after a dropped stream, since only it
 *    knows a gap happened.
 *  - `retry: 1` — a workspace server on loopback either answers or is down.
 *  - `gcTime` left at the default (5 min): board columns open and close
 *    constantly and their data is cheap to keep briefly.
 */
export function createCorpusQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
        retryDelay: 500,
      },
    },
  });
}
