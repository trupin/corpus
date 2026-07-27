import { describe, expect, it } from "vitest";
import type { AppendLogResult } from "./job.js";
import {
  AppendLogRequestSchema,
  AppendLogResultSchema,
  DEFAULT_RECENT_JOBS,
  JobListSchema,
  JobLogLineSchema,
  JobLogQuerySchema,
  JobLogSchema,
  JobSchema,
  JobsQuerySchema,
  MAX_RECENT_JOBS,
} from "./job.js";

const job = {
  eventId: "evt_7c1d",
  status: "in-progress",
  started: "2026-07-19T10:05:02Z",
  updated: "2026-07-19T10:05:40Z",
  lastLine: "reading doc_a1b2c3",
  originId: "th_x9y8",
  originTitle: "Re: 30-year fixed assumption",
};

describe("Job", () => {
  it("round-trips a console row", () => {
    expect(JobSchema.parse(job)).toEqual(job);
  });

  it("round-trips a job that has not logged yet and has no origin", () => {
    const fresh = { ...job, lastLine: null, originId: null, originTitle: null };
    expect(JobSchema.parse(fresh)).toEqual(fresh);
  });

  /**
   * The console labels rows without a second fetch each, so the title rides
   * along — but it is a denormalised read, and a job whose origin has since been
   * deleted still has to be representable.
   */
  it("keeps a titleless origin representable, and the key present", () => {
    const untitled = { ...job, originTitle: null };
    expect(JobSchema.parse(untitled).originTitle).toBeNull();

    const { originTitle: _dropped, ...missing } = job;
    expect(JobSchema.safeParse(missing).success).toBe(false);
  });

  it("mirrors the queue statuses, so a job cannot report a status the queue lacks", () => {
    expect(JobSchema.safeParse({ ...job, status: "running" }).success).toBe(false);
  });
});

describe("JobLogLine", () => {
  it("round-trips a line of the jsonl stream", () => {
    const line = { ts: "2026-07-19T10:05:40Z", line: "reading doc_a1b2c3" };
    expect(JobLogLineSchema.parse(line)).toEqual(line);
  });

  it("accepts an empty line rather than dropping it", () => {
    expect(JobLogLineSchema.parse({ ts: "2026-07-19T10:05:40Z", line: "" }).line).toBe("");
  });
});

describe("JobsQuery", () => {
  it("defaults the console window", () => {
    expect(JobsQuerySchema.parse({}).recent).toBe(DEFAULT_RECENT_JOBS);
  });

  it("reads the count from a query string", () => {
    expect(JobsQuerySchema.parse({ recent: "10" }).recent).toBe(10);
  });

  it.each([0, MAX_RECENT_JOBS + 1, 1.5])("rejects recent=%s", (recent) => {
    expect(JobsQuerySchema.safeParse({ recent }).success).toBe(false);
  });
});

describe("JobList", () => {
  it("round-trips the console's master list", () => {
    expect(JobListSchema.parse({ jobs: [job] })).toEqual({ jobs: [job] });
  });

  it("round-trips an idle workspace with no jobs yet", () => {
    expect(JobListSchema.parse({ jobs: [] })).toEqual({ jobs: [] });
  });
});

describe("JobLogQuery and JobLog", () => {
  it("starts at the beginning of the log when no cursor is given", () => {
    expect(JobLogQuerySchema.parse({}).cursor).toBe(0);
  });

  it("reads the cursor from a query string", () => {
    expect(JobLogQuerySchema.parse({ cursor: "12" }).cursor).toBe(12);
  });

  it("rejects a negative cursor", () => {
    expect(JobLogQuerySchema.safeParse({ cursor: -1 }).success).toBe(false);
  });

  it("round-trips a page of log lines with its next cursor", () => {
    const log = {
      lines: [{ ts: "2026-07-19T10:05:40Z", line: "reading doc_a1b2c3" }],
      nextCursor: 1,
    };
    expect(JobLogSchema.parse(log)).toEqual(log);
  });

  it("round-trips an empty tail, which is how a caller learns nothing was added", () => {
    expect(JobLogSchema.parse({ lines: [], nextCursor: 7 })).toEqual({ lines: [], nextCursor: 7 });
  });
});

describe("AppendLogRequest and AppendLogResult", () => {
  it("carries one line through", () => {
    expect(AppendLogRequestSchema.parse({ line: "ran the tests" })).toEqual({
      line: "ran the tests",
    });
  });

  it("rejects an empty line, which would be a no-op append", () => {
    expect(AppendLogRequestSchema.safeParse({ line: "" }).success).toBe(false);
  });

  it("round-trips the append acknowledgement", () => {
    const result = { eventId: "evt_7c1d", appended: true };
    expect(AppendLogResultSchema.parse(result)).toEqual(result);
  });

  /**
   * The server's log file is capped, and past that cap it answers `201` while
   * writing nothing (SPEC.md §7). `appended` is the only field that can say so,
   * which is why it is a boolean rather than `literal(true)`.
   */
  it("round-trips the honest refusal of a line dropped at the file cap", () => {
    const result = { eventId: "evt_7c1d", appended: false };
    expect(AppendLogResultSchema.parse(result)).toEqual(result);
  });

  /**
   * A type-level probe, checked by `tsc --noEmit` rather than at runtime: the
   * annotation is what fails to compile if `appended` narrows back to `true`.
   */
  it("makes the refusal representable in the inferred type, not just at parse time", () => {
    const capped: AppendLogResult = { eventId: "evt_7c1d", appended: false };
    expect(capped.appended).toBe(false);
  });

  it("still rejects a non-boolean acknowledgement rather than coercing it", () => {
    expect(AppendLogResultSchema.safeParse({ eventId: "evt_7c1d", appended: "no" }).success).toBe(
      false,
    );
  });
});
