/** @vitest-environment jsdom */
import { DEFAULT_RECENT_JOBS, type Job } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { jobFixture, readerTransport } from "../testing/readerFixture";
import {
  agentWaitSince,
  pickOutstandingJob,
  useOutstandingAgentJob,
} from "./outstandingAgentRequest";

afterEach(cleanup);

const THREAD = "thread-standup";

/** `n` settled jobs belonging to other threads — the traffic a real queue carries. */
function noise(n: number): Job[] {
  return Array.from({ length: n }, (_, index) =>
    jobFixture({
      eventId: `evt_noise_${String(index)}`,
      status: "processed",
      originId: `thread-other-${String(index)}`,
      started: `2026-07-01T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }),
  );
}

describe("pickOutstandingJob", () => {
  it("finds nothing in an empty queue", () => {
    expect(pickOutstandingJob([], THREAD)).toBeNull();
  });

  it("ignores jobs belonging to other threads", () => {
    const job = jobFixture({ status: "pending", originId: "thread-other" });
    expect(pickOutstandingJob([job], THREAD)).toBeNull();
  });

  it.each(["processed", "failed", "abandoned"] as const)("ignores a %s job", (status) => {
    expect(pickOutstandingJob([jobFixture({ status, originId: THREAD })], THREAD)).toBeNull();
  });

  it.each(["pending", "in-progress", "deferred"] as const)("counts a %s job", (status) => {
    const job = jobFixture({ status, originId: THREAD });
    expect(pickOutstandingJob([job], THREAD)?.eventId).toBe(job.eventId);
  });

  /**
   * The scan itself has no bound. A queue can hand back up to `MAX_RECENT_JOBS`
   * rows and the thread's own job may be the last of them; a client-side cap
   * would reintroduce, one layer lower, exactly the truncation the module
   * docblock is about.
   */
  it("finds the thread's job however far down the list it sits", () => {
    const buried = jobFixture({ eventId: "evt_buried", status: "pending", originId: THREAD });
    expect(pickOutstandingJob([...noise(199), buried], THREAD)?.eventId).toBe("evt_buried");
  });

  /**
   * Two queued events are one wait as far as the person looking at the card is
   * concerned, and it began with the first of them.
   */
  it("reports the oldest of several outstanding jobs, whatever order they arrive in", () => {
    const older = jobFixture({
      eventId: "evt_older",
      status: "deferred",
      originId: THREAD,
      started: "2026-07-01T10:05:00.000Z",
    });
    const newer = jobFixture({
      eventId: "evt_newer",
      status: "pending",
      originId: THREAD,
      started: "2026-07-01T10:40:00.000Z",
    });
    expect(pickOutstandingJob([newer, older, ...noise(10)], THREAD)?.eventId).toBe("evt_older");
    expect(pickOutstandingJob([older, newer], THREAD)?.eventId).toBe("evt_older");
  });

  it("does not let an unreadable stamp win the oldest slot", () => {
    const broken = jobFixture({ eventId: "evt_broken", started: "not a date", originId: THREAD });
    const real = jobFixture({
      eventId: "evt_real",
      originId: THREAD,
      started: "2026-07-01T10:05:00.000Z",
    });
    // Still returned when it is all there is — a job with a bad stamp is a job.
    expect(pickOutstandingJob([broken], THREAD)?.eventId).toBe("evt_broken");
    expect(pickOutstandingJob([broken, real], THREAD)?.eventId).toBe("evt_real");
  });

  it("is exhaustive over whatever list it is handed", () => {
    const deferred = jobFixture({
      eventId: "evt_deferred",
      status: "deferred",
      originId: THREAD,
      started: "2026-07-01T09:00:00.000Z",
      blockedOn: "doc-standup",
    });

    expect(pickOutstandingJob([...noise(DEFAULT_RECENT_JOBS), deferred], THREAD)?.eventId) //
      .toBe("evt_deferred");
  });
});

/**
 * UI-069, and the reason CONTRACT-030 and SERVER-056 were filed.
 *
 * This used to read the console's unfiltered `useJobs({})` and scan it, so the
 * answer was bounded by `DEFAULT_RECENT_JOBS`. A deferred job waits indefinitely
 * on an edit lock (SPEC.md §7), so its `updated` stops advancing while the queue
 * moves; one window of newer traffic later it was off the end of the response,
 * the "working…" row vanished, and the reply was still coming.
 *
 * Asserted at the **transport**, not the scan: `readerTransport` answers
 * `/api/jobs` the way the server does — `recent` bounds the console list and is
 * ignored once `originId` is given — so a caller that went back to scanning
 * would fail these, while a test over `pickOutstandingJob` alone could not tell
 * the two apart.
 */
describe("useOutstandingAgentJob", () => {
  const deferred = jobFixture({
    eventId: "evt_deferred",
    status: "deferred",
    originId: THREAD,
    started: "2026-07-01T09:00:00.000Z",
    blockedOn: "doc-standup",
  });

  function setup(jobs: readonly Job[]) {
    const wire = readerTransport({ jobs });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const view = renderHook(() => useOutstandingAgentJob(THREAD), { wrapper: harness.Wrapper });
    return { ...view, wire };
  }

  it("finds a job buried behind more than a full console window", async () => {
    // Newest-touched first, as the server orders: the deferral is last of 51.
    const { result, wire } = setup([...noise(DEFAULT_RECENT_JOBS), deferred]);

    await waitFor(() => {
      expect(result.current?.eventId).toBe("evt_deferred");
    });

    // …because the question went to the server, rather than being scanned here.
    const asked = wire.of("GET", "/api/jobs").at(-1);
    expect(asked?.search).toContain(`originId=${THREAD}`);
    expect(asked?.search).toContain("status=pending%2Cin-progress%2Cdeferred");
  });

  it("reports nothing when the thread has no outstanding job", async () => {
    const { result, wire } = setup(noise(3));

    await waitFor(() => {
      expect(wire.of("GET", "/api/jobs").length).toBeGreaterThan(0);
    });
    expect(result.current).toBeNull();
  });
});

describe("agentWaitSince", () => {
  const ask = "2026-07-01T10:05:00.000Z";
  const turn = (ts: string) => ({ ts });

  it("counts from the enqueue instant, which is the requesting turn's", () => {
    // The note landed three minutes after the ask; the wait is the ask's.
    const job = jobFixture({ started: ask });
    expect(agentWaitSince(job, [turn(ask), turn("2026-07-01T10:08:00.000Z")])).toBe(ask);
  });

  it("holds the clock still when the job's start runs ahead of the conversation", () => {
    // A job that sat queued and only started logging at 10:20 must not reset the
    // wait to zero: the request cannot be newer than the thread's last turn.
    const job = jobFixture({ started: "2026-07-01T10:20:00.000Z" });
    expect(agentWaitSince(job, [turn(ask)])).toBe(ask);
  });

  /**
   * The step the review of PR #21 found. `Job.started` flips from enqueue-time to
   * first-log-time (CONTRACT-029), and a note-only turn arriving afterwards used
   * to drag `min(started, latestTurn)` forward with it — the displayed wait
   * jumping *down* by the whole queueing delay, which is the reset this function
   * exists to prevent.
   */
  it("does not step forward when a note-only turn lands after the job started logging", () => {
    const job = jobFixture({ started: "2026-07-01T10:07:00.000Z" });
    const before = agentWaitSince(job, [turn(ask)]);
    const after = agentWaitSince(job, [turn(ask), turn("2026-07-01T10:25:00.000Z")]);
    expect(before).toBe(ask);
    expect(after).toBe(ask);
  });

  it("is unmoved by any number of later turns", () => {
    const job = jobFixture({ started: "2026-07-01T10:07:00.000Z" });
    const later = ["10:25", "11:00", "12:30", "23:59"].map((hm) =>
      turn(`2026-07-01T${hm}:00.000Z`),
    );
    expect(agentWaitSince(job, [turn(ask), ...later])).toBe(ask);
  });

  /**
   * The residue CONTRACT-029 owns. A turn posted between the enqueue and the
   * first log joins the eligible set the moment `started` flips to the log's
   * timestamp, so `since` moves 10:05 → 10:06 — bounded by (first log − enqueue),
   * and unfixable without the enqueue instant as a field of its own. Recorded,
   * not blessed.
   */
  it("still steps within the gap between the enqueue and the first log (CONTRACT-029)", () => {
    const note = "2026-07-01T10:06:00.000Z";
    const queued = jobFixture({ started: ask });
    const logging = jobFixture({ started: "2026-07-01T10:07:00.000Z" });
    expect(agentWaitSince(queued, [turn(ask), turn(note)])).toBe(ask);
    expect(agentWaitSince(logging, [turn(ask), turn(note)])).toBe(note);
  });

  it("uses the job's own start when the thread has no turns to bound it", () => {
    expect(agentWaitSince(jobFixture({ started: ask }), [])).toBe(ask);
  });

  it("uses the job's own start when every turn is newer than it", () => {
    const job = jobFixture({ started: ask });
    expect(agentWaitSince(job, [turn("2026-07-01T10:06:00.000Z")])).toBe(ask);
  });

  it("never invents an instant out of an unparseable one", () => {
    expect(agentWaitSince(jobFixture({ started: "not a date" }), [turn(ask)])).toBe("not a date");
    expect(agentWaitSince(jobFixture({ started: ask }), [turn("not a date")])).toBe(ask);
  });

  it("reads past an unparseable turn to the readable one behind it", () => {
    const job = jobFixture({ started: "2026-07-01T10:20:00.000Z" });
    expect(agentWaitSince(job, [turn(ask), turn("not a date")])).toBe(ask);
  });
});
