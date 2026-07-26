import { z } from "@hono/zod-openapi";

/**
 * Liveness/readiness probe backing the CLI's `corpus server status` and the
 * start-up wait (SPEC.md §2.1). Deliberately unauthenticated.
 */
export const HealthSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().describe("Version of the running `corpus` tool."),
    uptimeSeconds: z.number().min(0),
    workspace: z.string().describe("Absolute path of the workspace this server owns."),
  })
  .openapi("Health");

export type Health = z.infer<typeof HealthSchema>;
