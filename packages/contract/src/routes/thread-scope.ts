import { createRoute, z } from "@hono/zod-openapi";
import { ThreadIdSchema } from "../schemas/id.js";
import { ORCHESTRATOR_LANE } from "../schemas/lane.js";
import { SCOPE_PAGE_SIZE, ThreadScopeSchema } from "../schemas/scope-listing.js";
import {
  CONFLICT_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * `GET /api/threads/{id}/scope` — what a designated thread's resident owns
 * (CONTRACT-068; SPEC.md §7's resident rider). The schema module
 * (`../schemas/scope-listing.ts`) carries the design; this file carries the
 * route's refusals and why each is the status it is.
 *
 * ## A read off a thread, in the shape `context` set
 *
 * One segment deeper than `/api/threads/{id}`, a `GET`, no query parameters and
 * no acting party — `getThreadContext`'s shape, for `getThreadContext`'s reason:
 * the bounds live in the contract rather than in a flag, and a read has no
 * author. `scope` competes with no parameter at that depth (every other route
 * there is a `POST`/`DELETE` on a distinct static segment), so registration
 * order is for readability only.
 *
 * ## `409` for a thread with no resident, and why not `404` or `200 []`
 *
 * The orchestrator's lane is not a scope: §7 defines scope only for a
 * *designated* thread, and everything outside every scope falls on the
 * orchestrator's lane by default — so "the scope of an undesignated thread" is
 * not an empty set, it is a question with no referent. A `404` would say the
 * thread does not exist, which is false and sends the caller to check the id.
 * A `200` with one member would invent a scope the queue does not route by,
 * which is the disagreement this whole route exists to avoid. `409` is the
 * repo's status for a request the state refuses (CONTRACT-038's rule: `400`
 * says "fix the body and retry", and no body fixes this) — the same family as
 * designating a thread that has a parent. The remedy is in the message: designate
 * a resident, or read the roster.
 */

const ThreadIdParamSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

export const getThreadScope = createRoute({
  method: "get",
  path: "/api/threads/{id}/scope",
  tags: ["threads"],
  summary: "What a designated thread's resident owns",
  description:
    "The **scope** of a designated thread (SPEC.md §7): the thread itself, every thread whose " +
    "parent chain reaches it, every document whose `origin` reaches it, and every thread on such " +
    "a document — that is, everything whose events are stamped with this thread's lane. **One " +
    "frugal line per member and never a body** (§7's retrieval discipline): id, kind, current " +
    "title, status, and the edge it reached the scope by (`self` for the root, `parent`, " +
    "`origin`).\n\n" +
    "**Computed per request, by the same walk the queue routes with** — `scope` is computed, " +
    "never stored (SPEC.md §7), so nothing here is a projection table or a cache: the server runs " +
    "the identical `walkScope` that decides an event's lane over the corpus and keeps what lands " +
    "on this one. A document created *before* the thread was designated is therefore listed when " +
    "its origin reaches it, exactly as the queue would route a comment on it; an archived document " +
    'is listed with `status: "archived"`, because archiving does not touch origin or parent and ' +
    "detaching is the only way out of a scope. A person asks this to see what an agent owns " +
    "(SPEC.md §10); a resident asks it to learn what it owns — reading your own lane is not a " +
    "sweep.\n\n" +
    `**Bounded at ${SCOPE_PAGE_SIZE} members, with no cursor and no total.** The root thread ` +
    "comes first, then the most recently updated members first, so a truncated page holds the " +
    "live end of the scope; `truncated` says when the cut happened. The bound exists so that a " +
    "scope cannot be an enumeration (§7 forbids the agent the sweep), not to make paging a " +
    "feature — a caller that needs one particular member reads it by id.\n\n" +
    `**\`409\` for a thread with no resident: the ${ORCHESTRATOR_LANE}'s lane is not a scope.** ` +
    "§7 defines scope only for a designated thread; everything outside every scope falls on the " +
    "orchestrator's lane by default, so an undesignated thread has no scope to list rather than " +
    "an empty one, and answering `[]` or the thread alone would invent a scope the queue does " +
    "not route by. The message says so and names the remedy: designate a resident, or read " +
    "`GET /api/agents` for the lanes that exist. `404` when the thread is unknown, and when the " +
    "id names a document that is not a thread, matching `GET /api/threads/{id}`. **No query " +
    "parameters**: the bound lives in the contract, not in a flag. Read-only; no acting party.",
  request: { params: ThreadIdParamSchema },
  responses: {
    200: jsonContent(
      ThreadScopeSchema,
      `The scope, root first, at most ${SCOPE_PAGE_SIZE} members, with \`truncated\` set when ` +
        "the cap cut it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});
