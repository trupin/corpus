import type { Job, JobLogLine } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { designationJob, readLaunchRecord } from "./launchRecord";

/**
 * The launch record AGENT-059 writes, as this tab reads it (UI-186).
 *
 * The two shapes below are the skill's own worked examples, copied from
 * `assets/workspace/claude/skills/orchestrate/SKILL.md`, so a workspace whose
 * guidance still says what it says today is what these assert against. They are
 * **fixtures and not this module's vocabulary**: nothing in `launchRecord.ts`
 * knows a model name, and a reader that stopped matching would leave the tab
 * saying the record is absent rather than saying something wrong.
 */

const DEFAULTED =
  "launched a converse listener on th_4b8e2c — a general resident " +
  "(Haiku — judged: no weight chosen, the lane is for quick factual lookups)";

const STATED =
  "launched a converse listener on th_4b8e2c — a general resident " +
  "(Opus 5 — stated at designation: heavy)";

function log(...lines: readonly string[]): readonly JobLogLine[] {
  return lines.map((line, index) => ({ ts: `2026-09-0${String(index + 1)}T09:00:00Z`, line }));
}

function job(over: Partial<Job> = {}): Job {
  return {
    eventId: "evt_1",
    type: "resident.designated",
    status: "processed",
    lane: "orchestrator",
    enqueued: "2026-09-01T09:00:00Z",
    started: null,
    updated: "2026-09-01T09:00:00Z",
    lastLine: null,
    originId: "th_solo",
    originTitle: "Q3 planning",
    blockedOn: null,
    blockedOnTitle: null,
    ...over,
  } satisfies Job;
}

describe("reading a launch record", () => {
  /**
   * The bug this file did not catch (pr-reviewer, PR #72). AGENT-059 shipped
   * `defaulted` in v0.31.0; AGENT-063 replaced it with `judged` a release later
   * and pinned the old word out of the skill. This module and every fixture in
   * it still read `defaulted`, so a lane launched by the shipped skill would
   * have found a record, failed to parse it, and reported *"No launch record
   * … is on the queue"* — false, on the mainline path of the feature the
   * release is named for.
   *
   * So: the shipped word is the primary fixture above, and the retired one is
   * still read, because a workspace installed from v0.31.0 has those lines on
   * its queue and they describe a real launch.
   */
  it("still reads the retired word a v0.31.0 workspace logged, as the judged case", () => {
    const record = readLaunchRecord(
      log("(Opus 5 — defaulted: no weight chosen, strongest declared tier)"),
    );
    expect(record).toEqual({
      provenance: "judged",
      clause: "Opus 5 — defaulted: no weight chosen, strongest declared tier",
    });
  });

  it("reports the clause a judged launch logged, verbatim, with its provenance", () => {
    expect(readLaunchRecord(log(DEFAULTED))).toEqual({
      provenance: "judged",
      clause: "Haiku — judged: no weight chosen, the lane is for quick factual lookups",
    });
  });

  it("reports a stated launch as a different fact, which is what the two words are for", () => {
    expect(readLaunchRecord(log(STATED))).toEqual({
      provenance: "stated",
      clause: "Opus 5 — stated at designation: heavy",
    });
  });

  /*
   * §7: a stated weight that cannot be met is launched at what the orchestrator
   * judges and the deviation logged on the same event. The newest clause is
   * therefore the one describing what is running.
   */
  it("takes the last clause in the log, not the first", () => {
    const lines = log(
      STATED,
      "could not meet heavy; launching anyway (Sonnet 4 — judged: level unavailable)",
    );
    expect(readLaunchRecord(lines)?.clause).toBe("Sonnet 4 — judged: level unavailable");
  });

  it("reads each parenthesised clause on its own, so a line carrying two yields the later", () => {
    const lines = log("relaunch (Opus 5 — stated at designation: heavy) after (a lapse)");
    expect(readLaunchRecord(lines)).toEqual({
      provenance: "stated",
      clause: "Opus 5 — stated at designation: heavy",
    });
  });

  /*
   * The whole of §10's standing rule at this grain: a log that recorded no
   * launch reports **nothing**, so the surface above can say so rather than
   * showing half a record or attributing a level nobody wrote down.
   */
  it("reports nothing for a log that recorded no launch", () => {
    expect(readLaunchRecord(log("claimed evt_1", "completed evt_1"))).toBeNull();
  });

  it("reports nothing for a log that is empty, which is what a reaped one reads as", () => {
    expect(readLaunchRecord([])).toBeNull();
  });

  it("does not read a provenance word that is not inside a clause", () => {
    expect(readLaunchRecord(log("the weight was judged, apparently"))).toBeNull();
  });
});

describe("finding the designation's own event", () => {
  it("takes the most recent designation of this lane", () => {
    const jobs = [job({ eventId: "evt_new" }), job({ eventId: "evt_old" })];
    expect(designationJob(jobs, "th_solo")?.eventId).toBe("evt_new");
  });

  it("ignores this lane's other events", () => {
    const jobs = [job({ eventId: "evt_c", type: "comment.created" }), job({ eventId: "evt_d" })];
    expect(designationJob(jobs, "th_solo")?.eventId).toBe("evt_d");
  });

  it("ignores a designation of another conversation", () => {
    expect(designationJob([job({ originId: "th_other" })], "th_solo")).toBeNull();
  });

  /*
   * A read that has not answered is not an answer (UI-098). `undefined` reads as
   * "no designation event" here only because {@link useLaunchRecord} never asks
   * this until the list has landed — the hook's own guard, asserted there.
   */
  it("answers nothing while the job list is undefined", () => {
    expect(designationJob(undefined, "th_solo")).toBeNull();
  });
});
