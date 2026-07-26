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

/** A job is a queue event being worked, so it is addressed by that event's id (SPEC.md §7). */
const JobIdParamSchema = z.object({
  id: EventIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

export const listJobs = createRoute({
  method: "get",
  path: "/api/jobs",
  tags: ["jobs"],
  summary: "Recent jobs for the console",
  description:
    "The console's master list: one row per queue event with its status and last log line " +
    "(SPEC.md §7, §11). `originId` links each row back to the document or thread it came from.",
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
    "refused with `404`.",
  security: [],
  request: {
    params: JobIdParamSchema,
    headers: ActorHeaderSchema,
    body: { content: { "application/json": { schema: AppendLogRequestSchema } } },
  },
  responses: {
    201: jsonContent(AppendLogResultSchema, "The line was appended."),
    400: VALIDATION_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const retryJob = createRoute({
  method: "post",
  path: "/api/jobs/{id}/retry",
  tags: ["jobs"],
  summary: "Retry a failed job",
  description:
    "Returns the event to `pending/` so the agent picks it up again — the retry action in the " +
    "console's detail header (SPEC.md §11).",
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
