import type { Job, QueueStatus } from "@corpus/contract";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  JOB_DOT_CLASSES,
  agentPillText,
  agentState,
  consoleCounts,
  isErrorLine,
  jobDotClass,
  jobLabel,
  jobStartedLabel,
  resolveSelectedJob,
} from "./consoleModel";

const IDLE: QueueStatus = {
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const label = (overrides: Pick<Job, "type" | "originTitle">): string => jobLabel(overrides);

describe("the six-to-five status mapping", () => {
  // The one that catches a status added to the contract with no console
  // treatment decided — the mapping is exhaustive by type, and by this test.
  it("maps every wire status the contract declares", () => {
    expect(Object.keys(JOB_DOT_CLASSES).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
  });

  it.each([
    ["pending", "pending"],
    ["in-progress", "running"],
    // CONTRACT-021: waiting on a lock reads as waiting, under its own class.
    ["deferred", "deferred"],
    ["processed", "done"],
    ["failed", "failed"],
    // Sprint-010 adjudication 8: no prototype colour, so no borrowed meaning.
    ["abandoned", ""],
  ] as const)("maps %s to the %s dot", (status, expected) => {
    expect(jobDotClass(status)).toBe(expected);
  });

  // The mistake worth pinning: a deferred job is not a broken one, and it is
  // not the neutral tombstone either.
  it("gives deferred a class of its own rather than failed's or abandoned's", () => {
    expect(jobDotClass("deferred")).not.toBe(jobDotClass("failed"));
    expect(jobDotClass("deferred")).not.toBe(jobDotClass("abandoned"));
  });
});

describe("the job row's label", () => {
  it("is `<event type> · <origin title>`", () => {
    expect(label({ type: "comment.created", originTitle: "Insurance carrier choice" })).toBe(
      "comment.created · Insurance carrier choice",
    );
  });

  it("drops the separator with the title rather than rendering undefined", () => {
    expect(label({ type: "agent.done", originTitle: null })).toBe("agent.done");
  });

  it("keeps a plugin's own event type verbatim", () => {
    expect(label({ type: "x/todos.rollover", originTitle: "Today" })).toBe(
      "x/todos.rollover · Today",
    );
  });
});

describe("the started clock", () => {
  it("renders local wall time to the minute", () => {
    const at = new Date(2026, 6, 27, 9, 12, 30);
    expect(jobStartedLabel(at.toISOString())).toBe("09:12");
  });

  it("shows the raw value rather than `Invalid Date` when the wire is odd", () => {
    expect(jobStartedLabel("not-a-time")).toBe("not-a-time");
  });
});

describe("the agent pill", () => {
  it("is idle with nothing in flight", () => {
    expect(agentState(IDLE)).toBe("idle");
    expect(agentPillText(IDLE)).toBe("agent: idle · queue 0");
  });

  it("is working while anything is in progress", () => {
    expect(agentPillText({ ...IDLE, inProgress: 1, pending: 2 })).toBe("agent: working · queue 2");
  });

  // Halted outranks working: the sentinel is set, so nothing further is claimed
  // and calling the agent "working" because one job is finishing would mislead.
  it("is halted even with a job still in progress", () => {
    expect(agentState({ ...IDLE, halted: true, inProgress: 3 })).toBe("halted");
  });
});

describe("the strip's counts", () => {
  it("omits the queued segment when nothing is pending", () => {
    expect(consoleCounts({ ...IDLE, inProgress: 1, processed: 4, failed: 1 })).toEqual({
      lead: "1 running · 4 done",
      failed: 1,
    });
  });

  it("includes it as soon as something is", () => {
    expect(consoleCounts({ ...IDLE, inProgress: 1, pending: 2, processed: 4 }).lead).toBe(
      "1 running · 2 queued · 4 done",
    );
  });

  it("still renders zeroes with no jobs at all", () => {
    expect(consoleCounts(IDLE)).toEqual({ lead: "0 running · 0 done", failed: 0 });
  });

  it("names deferred work rather than hiding it in queued or failed", () => {
    expect(consoleCounts({ ...IDLE, pending: 2, deferred: 1, processed: 4 })).toEqual({
      lead: "0 running · 2 queued · 1 deferred · 4 done",
      failed: 0,
    });
  });

  it("omits the deferred segment when nothing is deferred", () => {
    expect(consoleCounts({ ...IDLE, pending: 2 }).lead).toBe("0 running · 2 queued · 0 done");
  });
});

describe("ERR classification", () => {
  it.each([
    ["08:44:10 ERR subagent timeout", true],
    ["08:44:10 error: subagent timeout", false],
    ["reading ERROR.md", true],
    ["nothing to see", false],
  ])("classifies %s", (line, expected) => {
    expect(isErrorLine(line)).toBe(expected);
  });
});

describe("the selection policy", () => {
  const jobs = [{ eventId: "evt_c" }, { eventId: "evt_b" }, { eventId: "evt_a" }];

  it("follows the newest job when nothing was chosen", () => {
    expect(resolveSelectedJob(jobs, null)).toBe("evt_c");
  });

  it("keeps an explicit choice when a newer job arrives", () => {
    expect(resolveSelectedJob([{ eventId: "evt_d" }, ...jobs], "evt_b")).toBe("evt_b");
  });

  it("falls back to the newest when the chosen job is gone", () => {
    expect(resolveSelectedJob(jobs, "evt_gone")).toBe("evt_c");
  });

  it("has nothing to select in an empty list", () => {
    expect(resolveSelectedJob([], "evt_b")).toBeNull();
  });
});
