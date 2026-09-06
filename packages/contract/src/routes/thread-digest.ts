import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  DIGEST_MAX_CHARS,
  ThreadDigestResponseSchema,
  WriteDigestRequestSchema,
} from "../schemas/digest.js";
import { UnknownRecipientErrorSchema, ValidationErrorSchema } from "../schemas/error.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

/**
 * Writing and clearing a thread's digest (SPEC.md §6, rider signed 2026-09-05).
 *
 * ## Two routes rather than one nullable write
 *
 * `thread-resident.ts`'s split, for the same reason it made it: `PUT` with an
 * empty body would have made *"nothing"* mean *"remove"* on a field where the
 * absence of a digest is already the ordinary state. A resident that meant to
 * write and sent an empty string would silently destroy the digest it was
 * updating. So writing is `PUT`, clearing is `DELETE`, and an empty `PUT` is
 * refused rather than reinterpreted.
 *
 * ## Why the refusals are `422` and not `400`
 *
 * `400` tells a client *"fix the body and retry"*. Both refusals here are about
 * the **act**, not the shape of the request:
 *
 * - A thread with **no resident** cannot hold a digest at all, because the rider
 *   makes the digest the resident's. No body makes that write land.
 * - An **empty** body means the caller wanted to clear, and clearing is a
 *   different verb on this path. No body makes *this* verb clear anything.
 *
 * In both cases retrying against this route with a different body cannot help,
 * which is exactly the line this package draws between `400` and a refusal the
 * state makes.
 *
 * ## Why no `403`, and where the "resident writes it" rule is enforced
 *
 * The rider says the resident writes the digest, and this contract enforces that
 * through the thread's **state** rather than through the acting party: a thread
 * with no resident is refused, and a thread with one has exactly one resident to
 * be. The acting party still travels in `x-corpus-author` and still becomes the
 * git author, so the write shows up in `git log` as whoever made it. That leaves
 * the CLI's own agent identity as the practical writer, which is what the rider
 * describes — *"written by the agent resident on the thread at reply time,
 * through the CLI"* — without this route having to decide that a person may
 * never clear a digest they can see is wrong.
 *
 * ## What the `422` on the clear costs, recorded rather than discovered
 *
 * Both verbs refuse a thread with no resident, so a digest **outlives the
 * ability to touch it**: resolving a thread releases its resident (SPEC.md §7),
 * and a resolved thread's digest can from then on be neither rewritten nor
 * removed. That is the rider's own consequence for the write — *"it is corrected
 * only by a resident writing it again"* — and this route extends it to the
 * clear so that the digest surface answers one question about a thread rather
 * than two. The stranded digest stays honest either way: it keeps its watermark,
 * and it reports `stale` if a turn it covers is later deleted or revised. If
 * that stranding turns out to matter in use, the change is to drop this one
 * refusal — a clear needs no authority a removal does not already have — and it
 * is additive to every client.
 */

const ThreadIdParamSchema = z.object({
  id: openapi(ThreadIdSchema, { param: { name: "id", in: "path", required: true } }),
});

/**
 * The two bodies the write's `422` can carry, told apart at `code` — the
 * arrangement `UNRESOLVED_REFERENCE_RESPONSE` uses, and for the reason it gives:
 * a client narrows on the code, so two refusals sharing a status must differ
 * there or one of them is unreachable.
 *
 * **No new error code was minted for either.** `unknown_recipient` already
 * publishes *"this workspace holds no such thread, or that thread holds no
 * resident and is therefore not a lane at all"* — the second clause is this
 * refusal exactly, and its remedy is the one that component names: designate a
 * resident on that thread. The empty body reuses `bad_request` on the argument
 * `PAYLOAD_TOO_LARGE_RESPONSE` settled: `ERROR_CODES` is a published
 * discriminant, so a new member touches every narrowing site in four domains,
 * and the status is what carries the distinction. `issues` names the field.
 *
 * The union is declared inline rather than registered as a component, because a
 * `oneOf` has no `type: "object"` and a registered name would propagate onto
 * anything derived from it (CONTRACT-037).
 */
const DIGEST_WRITE_REFUSED_RESPONSE = jsonContent(
  z.union([ValidationErrorSchema, UnknownRecipientErrorSchema]),
  "The write was refused and nothing was written. `unknown_recipient` — the thread holds no " +
    "resident, and a digest is the resident's (SPEC.md §6); `recipient` carries the thread id, " +
    "and the remedy is `POST /api/threads/{id}/resident`. `bad_request` — the body is blank, and " +
    "an empty write is not a clear: `DELETE /api/threads/{id}/digest` removes a digest.",
);

const DIGEST_CLEAR_REFUSED_RESPONSE = jsonContent(
  UnknownRecipientErrorSchema,
  "The thread holds no resident, so it has no digest to clear (SPEC.md §6): a digest belongs to " +
    "a resident, and a thread without one never has one. Nothing was written. `recipient` carries " +
    "the thread id — the same code and the same field the write is refused with, because it is " +
    "the same fact about the same thread.",
);

export const writeThreadDigest = createRoute({
  method: "put",
  path: "/api/threads/{id}/digest",
  tags: ["threads"],
  summary: "Write the thread's digest",
  description:
    "Records a **digest** on the thread: a short prose account of the conversation so far, " +
    "written by the thread's resident (SPEC.md §6, rider signed 2026-09-05). One per thread — a " +
    "write replaces whatever was there, and there is no history of them on this surface. The " +
    "digest reads back on `GET /api/threads/{id}` and in the thread's context pack.\n\n" +
    "**The body carries prose and nothing else. The server stamps the watermark**, which is the " +
    "timestamp of the newest turn the thread holds at the instant of the write. There is no " +
    "`watermark` field to send, and sending one is a `400` naming the key: only the server knows " +
    "what the newest turn is at that instant, so a watermark chosen by the writer is a claim " +
    "about a moment that has already passed — it would over-claim coverage of a turn the digest " +
    "never saw. The response carries the stamped value, so the writer never has to re-read the " +
    "thread to learn what it just wrote.\n\n" +
    "**A write clears `stale`.** Staleness means a turn at or before the watermark was deleted " +
    "or revised since the digest was written, and the rider makes rewriting the digest the only " +
    "thing that corrects it — the server records staleness and repairs nothing.\n\n" +
    "**Refusals.** `404` when the thread is unknown, or when the id names a document that is not " +
    "a thread. `422` in two cases, told apart at `code`: `unknown_recipient` when the thread " +
    "holds **no resident**, because a digest is the resident's and a thread without one may not " +
    "have one; `bad_request` when the body is **blank**, because clearing a digest is " +
    "`DELETE /api/threads/{id}/digest` and an empty write is not a clear. Both are `422` rather " +
    "than `400` because retrying this route with a different body cannot help in either case. A " +
    `body longer than ${DIGEST_MAX_CHARS} characters is an ordinary \`400\`, since a shorter one ` +
    "is exactly what would work.\n\n" +
    "**One action, one commit** (SPEC.md §4), authored by the acting party: the write rewrites " +
    "the thread file's frontmatter and auto-commits it, so the response carries §11's warnings — " +
    "a workspace hook that rejects the commit leaves the digest on disk and uncommitted. It " +
    "presents no key (SPEC.md §7): it writes one frontmatter field and replaces nothing a reader " +
    "was holding.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The digest's prose. The server supplies everything else about it.",
      content: { "application/json": { schema: WriteDigestRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      ThreadDigestResponseSchema,
      "The digest as stored — the body as written, the server's stamped `watermark`, and `stale` " +
        "false — plus any warnings raised while writing it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    422: DIGEST_WRITE_REFUSED_RESPONSE,
  },
});

export const clearThreadDigest = createRoute({
  method: "delete",
  path: "/api/threads/{id}/digest",
  tags: ["threads"],
  summary: "Clear the thread's digest",
  description:
    "Removes the thread's digest, leaving the thread in the state the rider calls ordinary: " +
    "**a thread with no digest is not a fault** (SPEC.md §6). This is the only way to clear one " +
    "— an empty `PUT` is refused rather than read as a clear, so a resident that meant to update " +
    "a digest can never destroy it by sending nothing.\n\n" +
    "**Idempotent.** Clearing a thread that has no digest is a `200` that changes nothing, " +
    "writes nothing and commits nothing. It answers with the same shape the write does, its " +
    "`digest` null, because a clear that *does* write can raise §11's warnings and a rejected " +
    "auto-commit has to be visible somewhere.\n\n" +
    "`404` when the thread is unknown. `422` when the thread holds no resident — the same " +
    "refusal the write makes, because a thread that may not have a digest may not be asked about " +
    "one either, and answering `200` there would tell a caller its clear had taken effect on a " +
    "surface that never had anything to clear.\n\n" +
    "It presents no key (SPEC.md §7): it clears one frontmatter field and replaces nothing a " +
    "reader was holding.",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ThreadDigestResponseSchema,
      "The thread, its `digest` now null, and any warnings raised while clearing it. Unchanged " +
        "when there was no digest to clear.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    422: DIGEST_CLEAR_REFUSED_RESPONSE,
  },
});
