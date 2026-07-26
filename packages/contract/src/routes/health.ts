import { createRoute } from "@hono/zod-openapi";
import { HealthSchema } from "../schemas/health.js";
import { jsonContent } from "./responses.js";

/**
 * One of the two deliberate auth exceptions (SPEC.md §2.1): the CLI probes this
 * while waiting for a freshly started server, before it has read the token.
 */
export const getHealth = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["health"],
  summary: "Liveness and readiness probe",
  description: "Unauthenticated. Backs `corpus server start|status` (SPEC.md §2.1).",
  security: [],
  responses: {
    200: jsonContent(HealthSchema, "The server is up and owns a workspace."),
  },
});
