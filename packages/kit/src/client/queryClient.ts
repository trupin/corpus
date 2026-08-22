import { QueryClient } from "@tanstack/react-query";
import { CorpusRequestError } from "./createCorpusClient.js";

/**
 * Query defaults for an SSE-invalidated cache (SPEC.md §10, "Live updates").
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
 *  - `retry: 1`, **except for a client error** — a workspace server on loopback
 *    either answers or is down, so one retry covers the transient case. A `4xx`
 *    is not transient: the server understood the request and refused it, and
 *    asking again gets the same answer. It matters beyond tidiness because a
 *    `404` is a *normal* answer here — an unresolved `[[ref]]` is legitimate
 *    (SPEC.md §5), and a body citing several not-yet-written documents would
 *    otherwise double its request count and its browser-console noise for
 *    nothing.
 *  - `gcTime` left at the default (5 min): board columns open and close
 *    constantly and their data is cheap to keep briefly.
 */

/** A refusal the server already decided; retrying changes nothing. */
export function isClientError(error: unknown): boolean {
  return error instanceof CorpusRequestError && error.status >= 400 && error.status < 500;
}

export function createCorpusQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) => failureCount < 1 && !isClientError(error),
        retryDelay: 500,
      },
    },
  });
}
