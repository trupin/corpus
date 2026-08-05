import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { findDocumentRow } from "../docs/index.js";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { readDocDiff, type DocDiffDeps } from "./diff.js";
import type { EditSessionTracker } from "./sessions.js";

/**
 * `GET /api/docs/{id}/diff` (SPEC.md §4's edit-acknowledgment rider,
 * CONTRACT-028) — the escalation a `doc.edited` event deliberately does not
 * carry, and the read behind `corpus doc diff <id>` (CLI-026).
 *
 * Mounted from `edit/` rather than from `docs/routes.ts` even though its path
 * sits under `/api/docs`: it is one half of the acknowledgment feature and
 * shares its whole implementation with the other half (`edit/diff.ts` computes
 * the stats a `doc.edited` carries *and* the body this route bounds). It also
 * needs the raw `Git` command builder, which `DocsWorkspace` deliberately does
 * not carry — that surface exposes only the committer and its lock, and the
 * skill rollback already had to be handed `gitCommands` separately for exactly
 * this reason.
 *
 * The route is a pure read: no acting party, no lock guard, no write.
 */
export function mountDocDiffRoutes(app: OpenAPIHono, deps: DocDiffDeps): void {
  app.openapi(contractRoutes.getDocDiff, async (c) =>
    c.json(await readDocDiff(deps, c.req.valid("param").id, c.req.valid("query")), 200),
  );
}

export interface EditSessionRouteDeps {
  readonly projection: ProjectionDb;
  readonly editSessions: EditSessionTracker;
}

/**
 * `POST /api/docs/{id}/edit-session/flush` (SPEC.md §4's **close** path,
 * CONTRACT-031) — the door onto {@link EditSessionTracker.flush}, which
 * SERVER-052 built and tested and which until now nothing called.
 *
 * The handler is three lines because every property the contract publishes is
 * the tracker's, not the route's, and re-deciding any of them here would be a
 * second answer to a question already answered:
 *
 * - **Idempotent.** `flush` ends every session it finds on this document and
 *   finds none when there are none; either way the postcondition the `204`
 *   asserts — this document has no open edit session — holds. There is no
 *   "nothing to flush" state for the route to report, because a caller cannot
 *   observe one: sessions open on the server's own write path and close on a
 *   timer the client cannot see.
 * - **One event per session.** `end()` removes the session from the map before
 *   it emits, so a flush racing the idle sweep finds nothing left to end.
 * - **Says nothing about emission.** `flush` is synchronous and the enqueue it
 *   starts is not; a session with an empty path-scoped range, or whose commits
 *   were all rejected under §14, emits nothing and still answers `204`.
 *
 * The one thing the route decides is its `404`, and it means an unknown
 * *document* — never "no session here". A permissive `204` for an id the
 * projection has never heard of would hide the client bug worth catching (a
 * stale id, a thread id, an `undefined` interpolated into a path), and the
 * projection is the same authority `GET /api/docs/{id}/diff` asks.
 *
 * No acting party: nothing is written and nothing is committed, so there is no
 * git author to attribute and the contract declares no `x-corpus-author`.
 */
export function mountEditSessionRoutes(app: OpenAPIHono, deps: EditSessionRouteDeps): void {
  app.openapi(contractRoutes.flushEditSession, (c) => {
    const { id } = c.req.valid("param");
    if (findDocumentRow(deps.projection, id) === null) throw notFound(`no document with id ${id}`);
    deps.editSessions.flush(id);
    return c.body(null, 204);
  });
}
