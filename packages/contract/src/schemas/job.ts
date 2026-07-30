import { z } from "@hono/zod-openapi";
import { DocumentIdSchema, EventIdSchema } from "./id.js";
import { CORE_QUEUE_EVENT_TYPES, QueueEventStatusSchema } from "./queue.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Every queue event is a job; the console renders one row per job with its live
 * log stream (SPEC.md §7). Full log lines stay in `.corpus/jobs/<eventId>.jsonl`
 * and are fetched over HTTP — SSE only announces that the log grew.
 */
export const JobSchema = z
  .object({
    eventId: EventIdSchema,
    type: z
      .string()
      .min(1)
      .describe(
        "The type of the queue event this job is running — the same value as `QueueEvent.type`, " +
          `read from the projection rather than re-derived. Core values: ${CORE_QUEUE_EVENT_TYPES.join(", ")}. ` +
          "Open rather than enumerated for the same reason `QueueEvent.type` is: plugins define " +
          "their own event types (SPEC.md §7, §10). The console's collapsed job row reads " +
          "`<type> · <originTitle>`, so this is what tells the user *what* is running, not just " +
          "what it is running on (SPEC.md §11).",
      ),
    status: QueueEventStatusSchema,
    started: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    lastLine: z
      .string()
      .nullable()
      .describe("Most recent log line, for the collapsed console row."),
    originId: DocumentIdSchema.nullable().describe(
      "Document or thread the job originated from, so the console can link through.",
    ),
    originTitle: z
      .string()
      .nullable()
      .describe(
        "**The current title of whatever `originId` names, or null.** Null exactly when `originId` " +
          "is null, or when the document it names no longer exists. It rides along so the console " +
          "can label a job row without a second fetch per row; it is a denormalised copy read at " +
          "response time, never a stored field, so a renamed document shows its new title on the " +
          "next read.",
      ),
    blockedOn: DocumentIdSchema.nullable().describe(
      "**The document whose edit lock this job is waiting for**, or null — non-null exactly when " +
        "`status` is `deferred` (SPEC.md §7, CONTRACT-021). It is the document supplied at defer " +
        "time, and the one whose release, break or reap returns the job to `pending` " +
        "automatically. The console needs it to say what a waiting row is waiting *for*: a " +
        "deferred job that names no document is indistinguishable from a stuck one.",
    ),
    blockedOnTitle: z
      .string()
      .nullable()
      .describe(
        "**The current title of whatever `blockedOn` names, or null** — the same denormalised " +
          "copy `originTitle` is, read at response time rather than stored, so a renamed document " +
          "shows its new title on the next read. Null exactly when `blockedOn` is null, or when " +
          "the document it names no longer exists.",
      ),
  })
  .openapi("Job");

export const JobLogLineSchema = z
  .object({ ts: IsoDateTimeSchema, line: z.string() })
  .openapi("JobLogLine", {
    description:
      "One line of `.corpus/jobs/<eventId>.jsonl`. Always rendered as plain text, never interpreted.",
  });

export const DEFAULT_RECENT_JOBS = 50;
export const MAX_RECENT_JOBS = 200;

export const JobsQuerySchema = z.object({
  recent: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_RECENT_JOBS)
    .default(DEFAULT_RECENT_JOBS)
    .openapi({
      param: { name: "recent", in: "query", required: false },
      type: "integer",
      minimum: 1,
      maximum: MAX_RECENT_JOBS,
      default: DEFAULT_RECENT_JOBS,
      description: `How many of the most recent jobs to return (1–${MAX_RECENT_JOBS}).`,
    }),
});

export const JobListSchema = z
  .object({ jobs: z.array(JobSchema).describe("Console rows, most recent first.") })
  .openapi("JobList");

/**
 * The console fetches log content over HTTP and refetches on SSE invalidation
 * (SPEC.md §7) — the stream announces that the log grew, never its contents. The
 * cursor makes that refetch incremental instead of re-reading the whole file.
 */
export const JobLogQuerySchema = z.object({
  cursor: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({
      param: { name: "cursor", in: "query", required: false },
      type: "integer",
      minimum: 0,
      default: 0,
      description:
        "Lines already held by the caller; pass back `nextCursor` to fetch only new ones.",
    }),
});

export const JobLogSchema = z
  .object({
    lines: z.array(JobLogLineSchema).describe("Log lines from `cursor` onwards, oldest first."),
    nextCursor: z
      .number()
      .int()
      .min(0)
      .describe("Cursor to pass on the next fetch; equals the total line count."),
  })
  .openapi("JobLog");

export const AppendLogRequestSchema = z
  .strictObject({
    line: z
      .string()
      .min(1)
      .describe(
        "One progress line. Rendered as plain text and never interpreted; the server caps its " +
          "length (SPEC.md §7).",
      ),
  })
  .openapi("AppendLogRequest");

/**
 * `appended` is a genuine boolean rather than `literal(true)`, because the
 * server has a real way to answer no: a job log is capped at a maximum file
 * size, and once a log reaches it every further line is dropped. That refusal
 * still answers `201` — the request was well formed and the cap is a property
 * of the log rather than of the call — so the status code cannot carry it, and
 * a literal `true` would have the response assert that a dropped line was
 * written. The one field that can be honest here is this one.
 */
export const AppendLogResultSchema = z
  .object({
    eventId: EventIdSchema,
    appended: z
      .boolean()
      .describe(
        "True when the line reached the log file. **False when the log is at its size cap** and " +
          "the line was dropped (SPEC.md §7): the call still succeeds with `201`, because the " +
          "request was well formed and nothing about it can be retried differently — but the line " +
          "is not there. A caller that reports progress from this endpoint reports the flag, not " +
          "the status code.",
      ),
  })
  .openapi("AppendLogResult");

export type Job = z.infer<typeof JobSchema>;
export type JobLogLine = z.infer<typeof JobLogLineSchema>;
export type JobsQuery = z.infer<typeof JobsQuerySchema>;
export type JobList = z.infer<typeof JobListSchema>;
export type JobLogQuery = z.infer<typeof JobLogQuerySchema>;
export type JobLog = z.infer<typeof JobLogSchema>;
export type AppendLogRequest = z.infer<typeof AppendLogRequestSchema>;
export type AppendLogResult = z.infer<typeof AppendLogResultSchema>;
