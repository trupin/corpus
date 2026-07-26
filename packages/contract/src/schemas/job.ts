import { z } from "@hono/zod-openapi";
import { DocumentIdSchema, EventIdSchema } from "./id.js";
import { QueueEventStatusSchema } from "./queue.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Every queue event is a job; the console renders one row per job with its live
 * log stream (SPEC.md §7). Full log lines stay in `.corpus/jobs/<eventId>.jsonl`
 * and are fetched over HTTP — SSE only announces that the log grew.
 */
export const JobSchema = z
  .object({
    eventId: EventIdSchema,
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
  .object({
    line: z
      .string()
      .min(1)
      .describe(
        "One progress line. Rendered as plain text and never interpreted; the server caps its " +
          "length (SPEC.md §7).",
      ),
  })
  .openapi("AppendLogRequest");

export const AppendLogResultSchema = z
  .object({ eventId: EventIdSchema, appended: z.literal(true) })
  .openapi("AppendLogResult");

export type Job = z.infer<typeof JobSchema>;
export type JobLogLine = z.infer<typeof JobLogLineSchema>;
export type JobsQuery = z.infer<typeof JobsQuerySchema>;
export type JobList = z.infer<typeof JobListSchema>;
export type JobLogQuery = z.infer<typeof JobLogQuerySchema>;
export type JobLog = z.infer<typeof JobLogSchema>;
export type AppendLogRequest = z.infer<typeof AppendLogRequestSchema>;
export type AppendLogResult = z.infer<typeof AppendLogResultSchema>;
