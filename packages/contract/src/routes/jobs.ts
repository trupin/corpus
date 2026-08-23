import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { EventIdSchema } from "../schemas/id.js";
import {
  AppendLogRequestSchema,
  AppendLogResultSchema,
  JobListSchema,
  JobLogQuerySchema,
  JobLogSchema,
  JobSchema,
  JobsQuerySchema,
} from "../schemas/job.js";
import {
  CONFLICT_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

/** A job is a queue event being worked, so it is addressed by that event's id (SPEC.md §7). */
const JobIdParamSchema = z.object({
  id: openapi(EventIdSchema, { param: { name: "id", in: "path", required: true } }),
});

export const listJobs = createRoute({
  method: "get",
  path: "/api/jobs",
  tags: ["jobs"],
  summary: "Recent jobs for the console, or the jobs outstanding on one document",
  description:
    "Two questions on one route. **Unfiltered** it is the console's master list: one row per " +
    "queue event with its status and last log line (SPEC.md §7, §10), most recently touched " +
    "first, and `originId` links each row back to the document or thread it came from. " +
    "**Filtered by `originId` (and usually `status`)** it is a predicate about a single " +
    "document — *is the agent still working here?* — which SPEC.md §8's pending row and the " +
    "board row's agent dot both need. That answer is **complete** — `recent` bounds the console " +
    "list and is ignored once `originId` is given — because a predicate about one document " +
    "cannot be allowed to be displaced by unrelated queue activity; that displacement is exactly " +
    'how a deferred job\'s "working…" row used to vanish while its reply was still coming ' +
    "(CONTRACT-030).",
  request: { query: JobsQuerySchema },
  responses: {
    200: jsonContent(JobListSchema, "Console rows, most recent first."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const getJobLog = createRoute({
  method: "get",
  path: "/api/jobs/{id}/log",
  tags: ["jobs"],
  summary: "A job's log lines",
  description:
    "Reads `.corpus/jobs/<eventId>.jsonl`. SSE announces only that the log grew (SPEC.md §2.2 " +
    "rule 3), so the console refetches here — pass the previous `nextCursor` to get just the new " +
    "lines. Log content is always rendered as plain text, never interpreted.",
  request: { params: JobIdParamSchema, query: JobLogQuerySchema },
  responses: {
    200: jsonContent(JobLogSchema, "Lines from the cursor onwards, plus the next cursor."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

/**
 * The one unauthenticated mutating endpoint (SPEC.md §7), so it is hardened as a
 * log sink rather than treated as an ordinary write: loopback peers only,
 * browser `Origin` headers refused, line length capped, unknown job ids refused.
 */
export const appendJobLog = createRoute({
  method: "post",
  path: "/api/jobs/{id}/log",
  tags: ["jobs"],
  summary: "Append a line to a job's log (loopback-only, tokenless)",
  description:
    "**Localhost-only and unauthenticated**, for Claude Code hooks such as `PostToolUse` which hold " +
    "no token. Appends to the same `.corpus/jobs/<eventId>.jsonl` that `corpus job log` writes " +
    "through. Hardening (SPEC.md §7): non-loopback peers and requests carrying a browser `Origin` " +
    "header are rejected with `403`, line length is capped, and appends to unknown job ids are " +
    "refused with `404`. The log **file** is capped too, and that cap does not fail the call: a " +
    "line dropped because the log is full still answers `201`, with `appended: false`.",
  security: [],
  request: {
    params: JobIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The line to append. There is nothing to append without one, so the body is mandatory.",
      content: { "application/json": { schema: AppendLogRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(
      AppendLogResultSchema,
      "The append was accepted; `appended` says whether the line actually reached the log.",
    ),
    400: VALIDATION_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const retryJob = createRoute({
  method: "post",
  path: "/api/jobs/{id}/retry",
  tags: ["jobs"],
  summary: "Retry a failed or deferred job",
  description:
    "Returns the event to `pending/` so the agent picks it up again — the retry action in the " +
    "console's detail header (SPEC.md §10).\n\n" +
    "It works on a **deferred** job too, and stays the manual override once deferrals re-enter " +
    "on their own (SPEC.md §7, CONTRACT-021): automatic re-entry handles the edit session ending, " +
    "and this handles everything it did not reach — a deferral an operator simply wants back " +
    "now, or one whose document was put down in a way the server never saw.",
  request: { params: JobIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(JobSchema, "The job, queued again."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

export const abandonJob = createRoute({
  method: "post",
  path: "/api/jobs/{id}/abandon",
  tags: ["jobs"],
  summary: "Abandon a failed job",
  description:
    "Gives up on the job, moving its event to `abandoned/` — the other half of the console's failed-job " +
    "actions. Nothing is deleted.",
  request: { params: JobIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(JobSchema, "The job, abandoned."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
