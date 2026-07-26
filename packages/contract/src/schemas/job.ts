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

export type Job = z.infer<typeof JobSchema>;
export type JobLogLine = z.infer<typeof JobLogLineSchema>;
