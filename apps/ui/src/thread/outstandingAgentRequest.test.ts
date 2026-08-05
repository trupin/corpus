import { describe, expect, it } from "vitest";
import { jobFixture } from "../testing/readerFixture";
import { agentWaitSince } from "./outstandingAgentRequest";

describe("agentWaitSince", () => {
  const started = "2026-07-01T10:05:00.000Z";

  it("counts from the enqueue instant, which is the requesting turn's", () => {
    // The note landed three minutes after the ask; the wait is the ask's.
    const job = jobFixture({ started });
    expect(agentWaitSince(job, "2026-07-01T10:08:00.000Z")).toBe(started);
  });

  it("holds the clock still when the job's start runs ahead of the conversation", () => {
    // A job that sat queued and only started logging at 10:20 must not reset the
    // wait to zero: the request cannot be newer than the thread's last turn.
    const job = jobFixture({ started: "2026-07-01T10:20:00.000Z" });
    expect(agentWaitSince(job, "2026-07-01T10:05:00.000Z")).toBe("2026-07-01T10:05:00.000Z");
  });

  it("uses the job's own start when the thread has no turns to bound it", () => {
    expect(agentWaitSince(jobFixture({ started }), undefined)).toBe(started);
  });

  it("never invents an instant out of an unparseable one", () => {
    expect(agentWaitSince(jobFixture({ started: "not a date" }), "2026-07-01T10:05:00.000Z")).toBe(
      "not a date",
    );
    expect(agentWaitSince(jobFixture({ started }), "not a date")).toBe(started);
  });
});
