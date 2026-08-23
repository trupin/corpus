import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  ReattachConflictErrorSchema,
  ReattachThreadRequestSchema,
  ReattachThreadResponseSchema,
} from "../schemas/reattach.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

const ThreadIdParamSchema = z.object({
  id: openapi(ThreadIdSchema, { param: { name: "id", in: "path", required: true } }),
});

/** The `409` of this route: a well-formed request the document's state refuses. */
export const REATTACH_CONFLICT_RESPONSE = jsonContent(
  ReattachConflictErrorSchema,
  "The document's state refuses the repair; `reason` says which state — the range changed under " +
    "the caller, it overlaps another thread's text, or the thread has no anchor to repair.",
);

/**
 * `POST /api/threads/{id}/reattach` — the only path on which a selector is
 * rewritten without a diff (SPEC.md §6; SERVER-059's repair half).
 *
 * ## Why a route exists at all
 *
 * Every other way an anchor changes has evidence. Creation has the document in
 * hand; reconciliation has the edit. This one has neither, and SERVER-059
 * proved that no reader ever will: deleting a line from a parallel list, and
 * renaming that line while deleting its sibling, yield the **same** body from
 * the same body and demand opposite answers. A thread whose selector never
 * byte-matched is therefore detached for the life of its document, and the only
 * party holding the missing evidence is the person who wrote the comment.
 *
 * So the repair is a **person's decision, carried on the wire** — not a score,
 * not a threshold, and not a candidate the server has to re-derive. A previous
 * attempt (SERVER-055) put a similarity measure on the read path and was
 * reverted for misattaching 8 of 12 shapes; a future reader meets this function
 * long before they meet that history, which is why the reasoning is here.
 *
 * ## User-only, deliberately
 *
 * The agent may not call this. Two independent reasons, and either alone would
 * settle it:
 *
 * 1. **It would be the reverted mistake with an HTTP door in front of it.** The
 *    route's whole justification is that the deciding evidence does not exist at
 *    read time. An agent calling it supplies a judgment it provably cannot make,
 *    and the result is permanent and invisible: a repaired anchor is
 *    indistinguishable from a healthy one, and `corpus doc check` reports
 *    nothing. §6 orders these outcomes explicitly — "a visible orphan beats a
 *    silent misattachment".
 * 2. **The agent never needs it.** Every case where a machine *does* hold the
 *    evidence is an edit, and edits already run reconciliation on the save path
 *    with the diff in hand. There is no legitimate agent call left over.
 *
 * `403` for `x-corpus-author: agent`, the same mechanism §9.2's other user-only
 * endpoints (document and turn deletion) already use. The acting party still
 * travels on every request and still becomes the git author, so `git log` shows
 * the repair as a person's act.
 */
export const reattachThread = createRoute({
  method: "post",
  path: "/api/threads/{id}/reattach",
  tags: ["threads"],
  summary: "Re-attach a thread to a range a person chose (user-only)",
  description:
    "Attaches an anchored thread to a range of its parent document's current body, chosen by a " +
    "**person**. The repair for a comment whose selector never byte-matched, which reconciliation " +
    "cannot fix: a save only ever carries an anchor forward or orphans it, and an anchor that was " +
    "never resolvable stays detached for the life of the document (SPEC.md §6).\n\n" +
    "**The request names a range, never a candidate.** A candidate index would oblige the server " +
    "to regenerate the same list the UI showed and count into it, so the moment the two lists " +
    "differ the same index means a different passage — the exact silent misattachment this route " +
    "exists to prevent. `range` is in `ResolvedAnchor.range`'s coordinate space, so a range read " +
    "from `GET /api/docs/{id}` can be sent straight back.\n\n" +
    "**Nothing the caller sends is stored.** The server reads the range's bytes out of the parent " +
    "and computes the whole selector — `exact` and its `prefix`/`suffix` context — from the " +
    "document itself, the same rule `POST /api/threads` follows (SERVER-071), so a repaired " +
    "anchor is in exactly the shape a save would have left it in and the two cannot drift. " +
    "`expectedText` is a **guard, not a selector**: the server refuses when the parent's live " +
    "bytes at that range are not what the caller was looking at, because the document may have " +
    "been saved between the person seeing the range and choosing it.\n\n" +
    "**User-only**: a request carrying `x-corpus-author: agent` is rejected with `403`. The " +
    "evidence this route runs on is a person's memory of what they commented on; SERVER-059 " +
    "showed it does not exist at read time, so a machine calling this would be guessing, and §6 " +
    "puts a visible orphan above a silent misattachment. The agent also has no need for it — " +
    "every edit that carries real evidence already reconciles on the save path.\n\n" +
    "**One action, one commit** (SPEC.md §4): the repair rewrites one `anchors` entry in the " +
    "parent's frontmatter and lands as a single auto-commit authored by the acting party. " +
    "Nothing else about the thread changes — not its status, not its turns, not its body. It " +
    "presents no key (§7): it rewrites one `anchors` entry, and `expectedText` is already the " +
    "same check by another route — a range whose bytes moved is refused on its own terms below." +
    "\n\n" +
    "**`409`, with a machine-readable `reason`.** `range-changed` — the parent no longer holds " +
    "`expectedText` at that range, or the range runs past the end of the body; the caller has to " +
    "re-read and choose again. `range-overlaps` — the range overlaps text another thread's anchor " +
    "already resolves over; §6 requires that two threads on disjoint text never end up claiming " +
    "overlapping text, so this is refused rather than merged or silently dropped. The thread's " +
    "**own** current anchor is not an overlap with itself. `not-anchored` — the thread is " +
    "standalone or a whole-document comment; giving one an anchor changes the scope of somebody's " +
    "comment rather than repairing it, and is not this route.\n\n" +
    "**A thread that already resolves may be re-attached too**, which moves it. A misattached " +
    "anchor is as wrong as a detached one, and refusing would leave delete-and-recreate — losing " +
    "the conversation — as the only correction. The guard and the overlap check make the move as " +
    "safe as the repair.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The range the person chose, and the bytes they saw there. Mandatory: a re-attach with no " +
        "range is not a decision.",
      content: { "application/json": { schema: ReattachThreadRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      ReattachThreadResponseSchema,
      "The repaired anchor — `orphaned: false`, and a `range` equal to the one the request named " +
        "— with the thread summary and any warnings raised while writing the parent.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: REATTACH_CONFLICT_RESPONSE,
  },
});
