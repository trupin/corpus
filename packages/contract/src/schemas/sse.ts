import { z } from "@hono/zod-openapi";

/** SSE event name the server uses for cache invalidation. */
export const INVALIDATE_EVENT = "invalidate";

/**
 * A TanStack Query key. The server never pushes data over SSE (SPEC.md §2.2
 * rule 3) — it announces which query keys went stale and the UI refetches over
 * plain HTTP, so the payload is exactly the key array the client already uses.
 */
export const QueryKeySchema = z
  .array(z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]))
  .openapi("QueryKey", { example: ["docs", { type: "note" }] });

export const InvalidatePayloadSchema = z
  .object({ keys: z.array(QueryKeySchema).min(1) })
  .openapi("InvalidatePayload");

export type QueryKey = z.infer<typeof QueryKeySchema>;
export type InvalidatePayload = z.infer<typeof InvalidatePayloadSchema>;
