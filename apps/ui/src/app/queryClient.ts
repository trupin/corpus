import { createCorpusQueryClient } from "@corpus/kit";
import type { QueryClient } from "@tanstack/react-query";

/**
 * The app's query cache.
 *
 * The defaults live in `@corpus/kit` (`createCorpusQueryClient`) because they
 * are a property of an SSE-invalidated cache rather than of this app: a plugin
 * rendered in its own harness needs the same `staleTime: Infinity`, the same
 * "never poll", and the same "reconnect is the bridge's job". Restating them
 * here would let the two drift, and a cache that quietly re-polls is exactly
 * the failure the kit's defaults exist to prevent.
 */
export function createQueryClient(): QueryClient {
  return createCorpusQueryClient();
}

export const appQueryClient: QueryClient = createQueryClient();
