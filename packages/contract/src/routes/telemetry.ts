import { createRoute, z } from "@hono/zod-openapi";
import { DocumentIdSchema } from "../schemas/id.js";
import {
  BYTES_PER_TOKEN,
  CostQuerySchema,
  DocumentCostSchema,
  InvocationReportRequestSchema,
  MAX_COST_BUCKETS,
} from "../schemas/telemetry.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

/**
 * Cost telemetry's two endpoints (SPEC.md §9.4): the report going in, and one
 * document's series coming out.
 *
 * **Both are derived runtime state, and neither has an acting party.** Nothing
 * here writes a workspace file, makes a git commit, or produces a queue event,
 * so there is no author to attribute — the same reason `POST /api/index/rebuild`
 * and `POST /api/check` declare no `x-corpus-author`. §9.4 puts it stronger than
 * a convention: these measurements are "telemetry about using the corpus, not
 * part of it — never a document, never committed".
 *
 * **The two are asymmetric on purpose.** Ingestion is a channel §9.4 requires to
 * be free — a report that fails to arrive costs the command nothing — so it
 * answers `204`, promises nothing, and reads nothing. The series is an ordinary
 * bounded read, with the ordinary `400`/`401`/`404` a document subresource has.
 *
 * **Neither announces anything over SSE.** The query-key vocabulary is closed
 * and its rendered description is part of the published document (`./events.ts`),
 * and a frame per `corpus` invocation would put the telemetry channel on the hot
 * path it exists to measure. A panel reading `GET /api/docs/{id}/cost` refetches
 * on the document frames that already exist (sprint-025 R8), so a report does
 * not update an open panel — which is the right relationship between a
 * measurement and the thing it measures.
 */

/**
 * Declared locally, exactly as every other `/api/docs/{id}/…` route declares
 * its own (`./docs.ts`, `./edit-session.ts`): one three-line object per module
 * beats a shared import that couples unrelated route files.
 */
const DocIdParamSchema = z.object({
  id: openapi(DocumentIdSchema, { param: { name: "id", in: "path", required: true } }),
});

export const reportInvocations = createRoute({
  method: "post",
  path: "/api/telemetry/invocations",
  tags: ["telemetry"],
  summary: "Report what one `corpus` invocation cost",
  description:
    "Records what an invocation of the CLI wrote and printed, attributed to the documents and " +
    "threads it named in its own input (SPEC.md §9.4). Bytes go in and nothing comes back: the " +
    `workspace's token estimate is derived server-side at ${String(BYTES_PER_TOKEN)} bytes to a ` +
    "token, in one place, so the CLI counts and converts nothing.\n\n" +
    "**This channel is advisory, and every word of that is load-bearing (SPEC.md §9.4).** *A " +
    "report that fails to arrive costs the command nothing and is never retried.* So: **loss is " +
    "acceptable** — a caller drops a failed report on the floor rather than buffering it to disk, " +
    "because a durable spool would give the channel the one property §9.4 defines it not to have. " +
    "**Idempotency is not promised**: this route has no request id and no deduplication, a repeat " +
    "is recorded a second time, and nothing here is safe to retry — which is the same sentence " +
    "read from the other end. **No verb's outcome may depend on this route.** A caller that lets " +
    "a `400`, a `401`, a timeout or a dead server change its exit code, its output, or its " +
    "latency budget has broken §9.4 rather than found a bug here.\n\n" +
    "**Deliberately minimal.** The command path is the finest grain: no per-flag detail, no " +
    "payload echo, no argv. The question the ledger answers is what a *document* costs, and a " +
    "record of what was typed would be a different thing wearing the same name.\n\n" +
    "**Two request forms.** One invocation, or a batch under `invocations` — the batch exists so " +
    "that a CLI which later buffers reports needs no second route, not because today's CLI " +
    "batches. A body that is neither form is a `400` whose message names the key that decided it.\n\n" +
    "**Reads nothing and refuses almost nothing.** A subject naming no document is kept: the " +
    "invocation happened, and a document deleted since is not a reason to lose the measurement. " +
    "The refusals that remain are shape refusals — a malformed command path, a negative byte " +
    "count, an array past its cap — and each of them is a client bug rather than a state " +
    "conflict.\n\n" +
    "No acting party: the report authors nothing, commits nothing, and emits no queue event.",
  request: {
    body: {
      required: true,
      description: "One invocation's measurement, or a batch of them under `invocations`.",
      content: { "application/json": { schema: InvocationReportRequestSchema } },
    },
  },
  responses: {
    204: {
      description:
        "Recorded. The answer carries no body and says nothing about what was stored — there is " +
        "nothing a caller may act on, because §9.4 forbids any verb's outcome from depending " +
        "on this call. A caller that ignores the response entirely is behaving correctly.",
    },
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const getDocCost = createRoute({
  method: "get",
  path: "/api/docs/{id}/cost",
  tags: ["telemetry"],
  summary: "What this document has cost over time",
  description:
    "This document's own cost over time, bucketed, beside its current size — the read behind " +
    '§9.4\'s *"is working with this document getting more expensive as it grows?"*, answered by ' +
    "looking rather than by feeling.\n\n" +
    "**The series and the reference line are different kinds of number, and the response keeps " +
    "them apart.** `buckets` is a history of what invocations naming this document wrote and " +
    "printed. `sizeBytes` is what the document weighs **right now** — one present-tense number, " +
    "never a second series — so a panel draws it as a horizontal line and labels it as today's " +
    "size. Flat cost against a rising size is the shape the panel exists to show.\n\n" +
    "**The server chooses the bucket granularity and says which it chose.** A caller must not " +
    "infer it from two boundaries: an empty bucket is a real answer, and reading one as a gap " +
    "turns a quiet week into a hole.\n\n" +
    `**Bounded, with the bound stated.** \`limit\` caps the buckets returned (up to ` +
    `${String(MAX_COST_BUCKETS)}), the **newest** are the ones kept, and \`total\` with ` +
    "`truncated` says whether anything older was cut — the same two words `GET /api/jobs` uses, " +
    "not a third spelling.\n\n" +
    "**Threads are documents, so a `th_*` id is legal here** and answers that thread's own " +
    "series. A thread's cost is not rolled up into its parent: §9.4 attributes cost to what the " +
    "invocation *named*, and a roll-up would be a second metric.\n\n" +
    "**An empty series is an honest answer, not an error.** A document nothing has been measured " +
    "against answers `200` with no buckets, and `measuringSince` says whether this workspace has " +
    "measured anything at all — telemetry is runtime state that a rebuild clears, and a panel " +
    "that cannot tell *never measured* from *measured since Tuesday* would present a short " +
    "history as a whole one.\n\n" +
    "**Nothing announces a new measurement.** The SSE key vocabulary is closed and gains no " +
    "telemetry shape, so a report **does not update an open panel** — a frame per `corpus` " +
    "invocation would put the telemetry channel on the hot path it exists to measure. A caller " +
    "refetches this on the document frames it already receives, which is the right relationship " +
    "between a measurement and the thing it measures.\n\n" +
    "Read-only; no acting party. The size comes from the projection, so this call performs no " +
    "filesystem read of the document.",
  request: { params: DocIdParamSchema, query: CostQuerySchema },
  responses: {
    200: jsonContent(
      DocumentCostSchema,
      "The document's cost series, oldest bucket first, with the granularity it is bucketed at " +
        "and the document's current size.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
