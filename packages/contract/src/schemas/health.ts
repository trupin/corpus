import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * Liveness/readiness probe backing the CLI's `corpus server status` and the
 * start-up wait (SPEC.md §2.1). Deliberately unauthenticated.
 */
export const HealthSchema = openapi(
  z.object({
    status: z.literal("ok"),
    version: z.string().describe("Version of the running `corpus` tool."),
    uptimeSeconds: z.number().min(0),
    workspace: z.string().describe("Absolute path of the workspace this server owns."),
  }),
  "Health",
);

export type Health = z.infer<typeof HealthSchema>;
