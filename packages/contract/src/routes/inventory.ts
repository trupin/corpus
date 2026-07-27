/**
 * The pinned method+path inventory of the Corpus HTTP API — every endpoint
 * SPEC.md §9.2 lists, plus the queue, lock and job verbs §7 requires and the
 * projection-maintenance pair behind §2.2's `corpus db rebuild` / `db doctor`.
 *
 * This list is the contract's own spec-compliance test: `openapi.test.ts`
 * asserts the generated document's paths × methods set equals it exactly, so
 * adding an endpoint to SPEC.md without declaring it here fails a test, and
 * declaring a route nobody asked for fails the same test from the other side.
 *
 * Deliberately absent, so neither omission reads as a gap:
 * - **Plugin routes** (`/api/x/<plugin>/…`) — discovered at runtime from the
 *   plugin directory (SPEC.md §10), never declared in a static document.
 * - **`GET /api/openapi.json`** — the server's own introspection endpoint, which
 *   serves the live document behind the bearer guard. It is server-local rather
 *   than client-facing: no typed client method should exist for it, so it is not
 *   contract surface.
 */
export const ENDPOINT_INVENTORY = [
  "GET /api/health",

  "GET /api/docs",
  "POST /api/docs",
  "GET /api/docs/{id}",
  "PUT /api/docs/{id}",
  "DELETE /api/docs/{id}",
  "POST /api/docs/{id}/move",
  "POST /api/docs/{id}/archive",
  "POST /api/docs/{id}/unarchive",

  "GET /api/tree",
  "POST /api/capture",

  "POST /api/threads",
  "GET /api/threads/{id}",
  "POST /api/threads/{id}/turns",
  "DELETE /api/threads/{id}/turns/{ts}",
  "POST /api/threads/{id}/resolve",
  "POST /api/threads/{id}/reopen",
  "POST /api/threads/{id}/seen",

  "GET /api/queue/status",
  "GET /api/queue/idle",
  "POST /api/queue/claim-all",
  "POST /api/queue/reap-stale",
  "POST /api/queue/halt",
  "POST /api/queue/resume",
  "POST /api/queue/{id}/complete",
  "POST /api/queue/{id}/fail",
  "DELETE /api/queue/{id}",

  "GET /api/locks",
  "POST /api/locks/reap",
  "POST /api/locks/{docId}",
  "DELETE /api/locks/{docId}",
  "POST /api/locks/{docId}/break",

  "GET /api/jobs",
  "GET /api/jobs/{id}/log",
  "POST /api/jobs/{id}/log",
  "POST /api/jobs/{id}/retry",
  "POST /api/jobs/{id}/abandon",

  "POST /api/db/rebuild",
  "GET /api/db/doctor",

  "GET /events",
  "GET /attachments/{path}",
] as const;

export type EndpointSignature = (typeof ENDPOINT_INVENTORY)[number];

/** `GET /api/docs` — the spelling both the inventory and the generated document use. */
export const endpointSignature = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path}`;
