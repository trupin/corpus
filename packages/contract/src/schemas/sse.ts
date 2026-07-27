import { z } from "@hono/zod-openapi";
import type { QueryKey } from "../query-keys.js";

/** SSE event name the server uses for cache invalidation. */
export const INVALIDATE_EVENT = "invalidate";

/**
 * A TanStack Query key. The server never pushes data over SSE (SPEC.md §2.2
 * rule 3) — it announces which query keys went stale and the UI refetches over
 * plain HTTP, so the payload is exactly the key array the client already uses.
 *
 * *Which* keys exist is a separate, closed question, answered by
 * `../query-keys.js`: this schema says what a well-formed key looks like, the
 * vocabulary says which nine the server actually emits.
 */
export const QueryKeySchema = z
  .array(z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]))
  .openapi("QueryKey", { example: ["docs", { type: "note" }] });

export const InvalidatePayloadSchema = z
  .object({ keys: z.array(QueryKeySchema).min(1) })
  .openapi("InvalidatePayload");

/**
 * Parses one key off the wire. Its return annotation is where the Zod-free
 * {@link QueryKey} type published in `../query-keys.js` and this schema are
 * pinned to each other — if the two ever drift, this stops compiling.
 */
export function parseQueryKey(value: unknown): QueryKey {
  return QueryKeySchema.parse(value);
}

export type InvalidatePayload = z.infer<typeof InvalidatePayloadSchema>;
