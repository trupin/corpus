import { QueryClient } from "@tanstack/react-query";

/**
 * Query defaults for an SSE-invalidated cache (SPEC.md §11, "Live updates").
 *
 * The server pushes `invalidate` events carrying query keys; the client turns
 * those into TanStack invalidations and refetches. That makes every form of
 * *guessing* about freshness wrong — and actively harmful, because a poll can
 * overwrite a value the user is mid-edit on:
 *
 *  - `staleTime: Infinity` — data is fresh until the server says otherwise.
 *    Nothing else knows better; the SSE bridge (UI-002) is the only authority.
 *  - `refetchOnWindowFocus: false`, `refetchOnReconnect: false` — refocusing a
 *    tab is not evidence of a change. Reconnect is handled where it belongs:
 *    the SSE bridge refetches after a dropped stream, since only it knows what
 *    was missed.
 *  - `retry: 1` — a workspace server on loopback either answers or is down. A
 *    single retry absorbs a restart; more just delays an honest error state.
 *  - `gcTime` left at the default (5 min): board columns are opened and closed
 *    constantly and their data is cheap to keep briefly.
 */
export function createQueryClient(): QueryClient {
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

export const appQueryClient: QueryClient = createQueryClient();
