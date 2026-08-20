// `GET /api/threads/{id}/scope` — what a designated thread's resident owns
// (SPEC.md §7, CONTRACT-068, SERVER-130).
//
// A pure read, like the context pack beside it: no acting party, no write, no
// commit, no invalidation. What it answers is the **inverse of the routing
// decision** — the queue climbs from an artifact to the lane that claims it, and
// this lists every artifact that climbs to one lane — so the whole of the
// derivation is `queue/scope.ts`'s `listScopeMembers`, which runs the identical
// `walkScope`. Nothing here decides membership; a rule with two implementations
// is the defect UI-119 spent a release on.
//
// Read off the **projection**, not off the files. Every field a member line
// carries — title, status, both edges — is a projected column, so a scope of two
// hundred members costs one scan and no file opens; and the projection is
// re-derived synchronously by every write, so "the member's current title" is
// true of it (SPEC.md §9.1).

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes, type DocStatus, type ScopeMember } from "@corpus/contract";
import { conflict, notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { isDesignatedRoot, listScopeMembers } from "../queue/scope.js";

export interface ThreadScopeDeps {
  readonly projection: ProjectionDb;
}

/**
 * The root's own line, and the proof that it is a thread at all.
 *
 * An inner join, because a thread that is not a document cannot exist: the
 * projector writes both rows from one file (`project-document.ts`). So a miss
 * here is "this workspace holds no such thread", which is the `404` — and it is
 * also the answer for a `th_…` id naming a plain document, the case
 * `GET /api/threads/{id}` refuses the same way.
 */
const ROOT_SQL = `
  SELECT documents.title AS title, documents.status AS status
  FROM threads
  JOIN documents ON documents.id = threads.id
  WHERE threads.id = ?`;

type RootRow = { readonly title: string; readonly status: DocStatus };

/**
 * The root as its own first member (SPEC.md §7: "the thread itself"), which is
 * also what {@link listScopeMembers} needs so that it never has to describe a
 * root it cannot find.
 *
 * `via: "self"` is the root and only the root: it is in its own scope because it
 * *is* the scope, by no edge at all.
 */
function rootMember(db: ProjectionDb, id: string): ScopeMember {
  const row = db.prepare(ROOT_SQL).get(id) as RootRow | undefined;
  if (row === undefined) throw notFound(`no thread with id ${id}`);
  return { id, kind: "thread", title: row.title, status: row.status, via: "self" };
}

/**
 * `409` for a thread with no resident — **the orchestrator's lane is not a
 * scope** (CONTRACT-068).
 *
 * §7 defines scope only for a designated thread, and everything outside every
 * scope falls on the orchestrator's lane by default. So an undesignated thread
 * has no scope to list rather than an empty one, and answering `[]` — or the
 * thread alone — would publish a scope the queue does not route by, which is the
 * disagreement this route exists to close.
 *
 * The predicate is {@link isDesignatedRoot}, shared with the lane walk, the
 * `recipient` refusal and the park refusal rather than restated here: since
 * SHARED-048 a designation may name no profile, and a fourth spelling keyed on
 * `resident_name` would make a general resident's lane unlistable while it stayed
 * routable.
 */
function assertDesignated(db: ProjectionDb, id: string): void {
  if (isDesignatedRoot(db, id)) return;
  throw conflict(
    `${id} has no resident, so it has no scope: SPEC.md §7 gives a scope to a designated thread, ` +
      "and everything outside every scope is the orchestrator's by default. Designate a resident " +
      "on this thread — which only a **standalone** thread may have, so a thread with a parent " +
      "cannot gain one and has no scope to ask for — or read `GET /api/agents` for the lanes " +
      "that exist.",
  );
}

export function mountThreadScopeRoutes(app: OpenAPIHono, deps: ThreadScopeDeps): void {
  app.openapi(contractRoutes.getThreadScope, (c) => {
    const { id } = c.req.valid("param");
    // Existence first, then designation: a thread that is not there is a `404`
    // whatever its frontmatter would have said, and a `409` about an id the
    // workspace does not hold would send the caller to designate a resident on
    // nothing.
    const root = rootMember(deps.projection, id);
    assertDesignated(deps.projection, id);
    const { members, truncated } = listScopeMembers(deps.projection, root);
    // Copied because the generated response type is a mutable array and the
    // listing hands back a readonly one — at most 200 lines, and the alternative
    // is publishing a mutable array from the derivation.
    return c.json({ thread: id, members: [...members], truncated }, 200);
  });
}
