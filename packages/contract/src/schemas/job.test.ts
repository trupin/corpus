import { describe, expect, it } from "vitest";
import { JobLogLineSchema, JobSchema } from "./job.js";

const job = {
  eventId: "evt_7c1d",
  status: "in-progress",
  started: "2026-07-19T10:05:02Z",
  updated: "2026-07-19T10:05:40Z",
  lastLine: "reading doc_a1b2c3",
  originId: "th_x9y8",
};

describe("Job", () => {
  it("round-trips a console row", () => {
    expect(JobSchema.parse(job)).toEqual(job);
  });

  it("round-trips a job that has not logged yet and has no origin", () => {
    const fresh = { ...job, lastLine: null, originId: null };
    expect(JobSchema.parse(fresh)).toEqual(fresh);
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
