/** @vitest-environment jsdom */
import { DEFAULT_RECENT_JOBS, MAX_RECENT_JOBS, type Job } from "@corpus/contract";
import { JOBS_KEY, createCorpusQueryClient } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { jobFixture, readerTransport } from "../testing/readerFixture";
import {
  agentWaitSince,
  deferredOnName,
  pendingStateOf,
  pickOutstandingJob,
  pickOutstandingRequest,
  useOutstandingAgentRequest,
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
 * UI-097. **"Outstanding" and "being worked" are two questions**, and until this
 * split they were answered with one job: a `pending` event nobody had claimed
 * put "agent is working…" on the card, escalating, while no agent was running.
 */
describe("pickOutstandingRequest", () => {
  it("reports nothing at all when nothing is outstanding", () => {
    expect(pickOutstandingRequest([], THREAD)).toBeNull();
    expect(
      pickOutstandingRequest([jobFixture({ status: "processed", originId: THREAD })], THREAD),
    ).toBeNull();
  });

  it("calls an unclaimed event waiting, not working", () => {
    const queued = jobFixture({ eventId: "evt_queued", status: "pending", originId: THREAD });
    expect(pickOutstandingRequest([queued], THREAD)).toEqual({
      job: queued,
      working: false,
      deferred: null,
    });
    expect(pendingStateOf(pickOutstandingRequest([queued], THREAD)!)).toBe("waiting");
  });

  it("calls a claimed event working", () => {
    const held = jobFixture({ eventId: "evt_held", status: "in-progress", originId: THREAD });
    expect(pickOutstandingRequest([held], THREAD)).toEqual({
      job: held,
      working: true,
      deferred: null,
    });
    expect(pendingStateOf(pickOutstandingRequest([held], THREAD)!)).toBe("working");
  });

  /**
   * A deferral was claimed and then parked because somebody is editing the
   * document it needs (SPEC.md §7). The reply is still coming — so it is still
   * outstanding — but nobody is working it this minute.
   *
   * **And it is not merely "waiting"** (UI-115). It was picked up, looked at,
   * and put down on purpose, and the wait is on the person reading the row — so
   * the request carries the document it is parked on and the state says so.
   */
  it("calls a deferral parked, and says what it is parked on", () => {
    const parked = jobFixture({
      eventId: "evt_parked",
      status: "deferred",
      originId: THREAD,
      blockedOn: "doc-standup",
      blockedOnTitle: "The standup notes",
    });
    const request = pickOutstandingRequest([parked], THREAD);
    expect(request).toEqual({
      job: parked,
      working: false,
      deferred: { docId: "doc-standup", title: "The standup notes" },
    });
    expect(pendingStateOf(request!)).toBe("deferred");
  });

  /**
   * A claim outranks a deferral: one event being held makes "the agent is
   * working on this thread" true, whatever else is parked behind it.
   */
  it("reports working rather than parked when something on the thread is claimed", () => {
    const parked = jobFixture({
      eventId: "evt_parked",
      status: "deferred",
      originId: THREAD,
      blockedOn: "doc-standup",
      started: "2026-07-01T10:00:00.000Z",
    });
    const held = jobFixture({
      eventId: "evt_held",
      status: "in-progress",
      originId: THREAD,
      started: "2026-07-01T10:20:00.000Z",
    });
    const request = pickOutstandingRequest([parked, held], THREAD);
    expect(request?.deferred).toBeNull();
    expect(pendingStateOf(request!)).toBe("working");
  });

  /**
   * …and a deferral outranks an unclaimed event, because it is the one wait
   * whose reason is knowable and whose end is in the reader's hands. The board
   * row's own signal applies the same precedence (`useRowSignals`).
   */
  it("prefers the parked event to an unclaimed one, oldest deferral first", () => {
    const queued = jobFixture({ eventId: "evt_queued", status: "pending", originId: THREAD });
    const newer = jobFixture({
      eventId: "evt_newer",
      status: "deferred",
      originId: THREAD,
      blockedOn: "doc-b",
      blockedOnTitle: "B",
      started: "2026-07-01T10:20:00.000Z",
    });
    const older = jobFixture({
      eventId: "evt_older",
      status: "deferred",
      originId: THREAD,
      blockedOn: "doc-a",
      blockedOnTitle: "A",
      started: "2026-07-01T10:00:00.000Z",
    });
    for (const jobs of [
      [queued, newer, older],
      [older, newer, queued],
    ]) {
      const request = pickOutstandingRequest(jobs, THREAD);
      expect(pendingStateOf(request!)).toBe("deferred");
      expect(request?.deferred).toEqual({ docId: "doc-a", title: "A" });
    }
  });

  /**
   * `blockedOn` is non-null exactly when the status is `deferred`
   * (CONTRACT-021), so this is off-contract — and it is still a deferral. The
   * wording drops the clause; the state does not fall back to "waiting", which
   * would be the false inference all over again.
   */
  it("still reports a deferral the wire named no document for", () => {
    const parked = jobFixture({ eventId: "evt_parked", status: "deferred", originId: THREAD });
    const request = pickOutstandingRequest([parked], THREAD);
    expect(pendingStateOf(request!)).toBe("deferred");
    expect(request?.deferred).toEqual({ docId: null, title: null });
    expect(deferredOnName(request!.deferred!)).toBeNull();
  });

  /**
   * Two asks, one wait: the clock runs from the older and the claim is read off
   * whichever event has one. Both directions, because the answer must not depend
   * on which of them the queue happened to list first.
   */
  it("counts from the oldest ask and reports the claim from any of them", () => {
    const older = jobFixture({
      eventId: "evt_older",
      status: "pending",
      originId: THREAD,
      started: "2026-07-01T10:00:00.000Z",
    });
    const newer = jobFixture({
      eventId: "evt_newer",
      status: "in-progress",
      originId: THREAD,
      started: "2026-07-01T10:20:00.000Z",
    });
    expect(pickOutstandingRequest([older, newer], THREAD)).toEqual({
      job: older,
      working: true,
      deferred: null,
    });
    expect(pickOutstandingRequest([newer, older], THREAD)).toEqual({
      job: older,
      working: true,
      deferred: null,
    });
  });

  /** Another thread's claim is not this thread's, however busy the queue is. */
  it("ignores a claim on somebody else's thread", () => {
    const mine = jobFixture({ eventId: "evt_mine", status: "pending", originId: THREAD });
    const theirs = jobFixture({
      eventId: "evt_theirs",
      status: "in-progress",
      originId: "thread-other",
    });
    expect(pickOutstandingRequest([mine, theirs], THREAD)).toEqual({
      job: mine,
      working: false,
      deferred: null,
    });
  });
});

/**
 * UI-069, and the reason CONTRACT-030 and SERVER-056 were filed; UI-075, and the
 * reason the question is no longer asked per thread.
 *
 * This used to read the console's unfiltered `useJobs({})` and scan it, so the
 * answer was bounded by `DEFAULT_RECENT_JOBS`. A deferred job waits indefinitely
 * on an edit lock (SPEC.md §7), so its `updated` stops advancing while the queue
 * moves; one window of newer traffic later it was off the end of the response,
 * the "working…" row vanished, and the reply was still coming.
 *
 * What fixes that is asking the **status** on the wire, which costs one shared
 * request rather than one per card: settled jobs are not in the outstanding list
 * at all, so no amount of finished traffic can bury anything in it. The exact
 * `?originId=` question is kept for the only case that list can still be short —
 * more unfinished events at one instant than a response carries.
 *
 * Asserted at the **transport**, not the scan: `readerTransport` answers
 * `/api/jobs` the way the server does — the filters are a `WHERE`, `recent`
 * bounds what is left, and is ignored once `originId` is given — so a caller
 * that went back to scanning the console list would fail these, while a test
 * over `pickOutstandingJob` alone could not tell the two apart.
 */
describe("useOutstandingAgentRequest", () => {
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
    const view = renderHook(() => useOutstandingAgentRequest(THREAD), { wrapper: harness.Wrapper });
    return { ...view, wire };
  }

  it("finds a job buried behind more than a full console window", async () => {
    // Newest-touched first, as the server orders: the deferral is last of 51.
    const { result, wire } = setup([...noise(DEFAULT_RECENT_JOBS), deferred]);

    await waitFor(() => {
      expect(result.current?.job.eventId).toBe("evt_deferred");
    });

    // …because the statuses went to the server, rather than being scanned here.
    const asked = wire.of("GET", "/api/jobs").at(-1);
    expect(asked?.search).toContain("status=pending%2Cin-progress%2Cdeferred");
    // …and without naming the thread, so every card on the document shares it.
    expect(asked?.search).not.toContain("originId");
  });

  /**
   * Three cards, one request. The fan-out UI-075 is about is per **thread**, and
   * a hook that shares its key cannot have one: the ids differ and the query
   * does not.
   */
  it("costs one request however many threads ask", async () => {
    const wire = readerTransport({ jobs: [deferred] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const view = renderHook(
      () => [
        useOutstandingAgentRequest(THREAD),
        useOutstandingAgentRequest("thread-other-1"),
        useOutstandingAgentRequest("thread-other-2"),
      ],
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(view.result.current[0]?.job.eventId).toBe("evt_deferred");
    });
    expect(view.result.current[1]).toBeNull();
    expect(view.result.current[2]).toBeNull();
    expect(wire.of("GET", "/api/jobs")).toHaveLength(1);
  });

  /**
   * The completeness UI-069 bought, kept. When the shared list comes back at the
   * cap it may be short, and the thread asks its own `?originId=` question —
   * which the server answers with no window at all, so the deferral behind two
   * hundred newer *unfinished* jobs is still found.
   */
  it("escalates to the exact question when the shared list is at the cap", async () => {
    const saturating = Array.from({ length: MAX_RECENT_JOBS }, (_, index) =>
      jobFixture({
        eventId: `evt_busy_${String(index)}`,
        status: "pending",
        originId: `thread-busy-${String(index)}`,
      }),
    );
    const { result, wire } = setup([...saturating, deferred]);

    await waitFor(() => {
      expect(result.current?.job.eventId).toBe("evt_deferred");
    });
    const filtered = wire.of("GET", "/api/jobs").filter((call) => call.search.includes("originId"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.search).toContain(`originId=${THREAD}`);
  });

  it("reports nothing when the thread has no outstanding job", async () => {
    const { result, wire } = setup(noise(3));

    await waitFor(() => {
      expect(wire.of("GET", "/api/jobs").length).toBeGreaterThan(0);
    });
    expect(result.current).toBeNull();
  });
});

/**
 * UI-076. **A truncation episode is not the only one there will ever be.**
 *
 * The escalation is parked between episodes, and parking a query does not empty
 * it: TanStack holds the last answer, and the app's `staleTime` is infinite. So
 * the second time the queue saturates, the exact query wakes up already holding
 * the *first* episode's answer — a job that has since finished — and a caller
 * that reads whatever data is in hand asserts a wait that ended minutes ago,
 * until the re-enable refetch lands.
 *
 * Driven the way the app is driven: the **production** query client (so the
 * infinite `staleTime` that makes the stale answer stick is the one under test),
 * and real `invalidate` frames through the kit's SSE bridge rather than a manual
 * `invalidateQueries` — the queue transitions that drain and re-saturate a real
 * queue arrive exactly that way.
 *
 * Asserted over **every render**, not the settled one. The lie is one round trip
 * long by construction; a `waitFor` on the final state cannot see it, and would
 * have passed against the code this issue was filed against.
 */
describe("useOutstandingAgentRequest across two truncation episodes", () => {
  /** `MAX_RECENT_JOBS` unfinished jobs of other threads — the shared list, at its cap. */
  function saturation(tag: string): Job[] {
    return Array.from({ length: MAX_RECENT_JOBS }, (_, index) =>
      jobFixture({
        eventId: `evt_${tag}_${String(index)}`,
        status: "pending",
        originId: `thread-busy-${String(index)}`,
      }),
    );
  }

  function episodes(jobs: readonly Job[]) {
    const wire = readerTransport({ jobs });
    const harness = createCorpusTestHarness({
      fetch: wire.fetch,
      queryClient: createCorpusQueryClient(),
    });
    const seen: (string | null)[] = [];
    renderHook(
      () => {
        const request = useOutstandingAgentRequest(THREAD);
        seen.push(request?.job.eventId ?? null);
        return request;
      },
      { wrapper: harness.Wrapper },
    );
    /** A queue transition, as the server announces one. */
    const transition = (next: readonly Job[]): void => {
      wire.setJobs(next);
      harness.eventSource.latest().invalidate([...JOBS_KEY]);
    };
    const escalations = (): number =>
      wire.of("GET", "/api/jobs").filter((call) => call.search.includes("originId")).length;
    return { seen, transition, escalations, wire };
  }

  const reply = jobFixture({
    eventId: "evt_reply",
    status: "pending",
    originId: THREAD,
    started: "2026-07-01T09:00:00.000Z",
  });

  /**
   * The three transitions that strand a stale answer, in the order a queue
   * produces them. The middle one is the load-bearing step: the escalation is
   * parked **while the thread's job is still unfinished**, so the answer it
   * keeps says "outstanding", and it is parked before the job settles, so
   * nothing refreshes it — an invalidation refetches active queries and marks
   * the rest stale.
   */
  async function strandAStaleAnswer(): Promise<ReturnType<typeof episodes>> {
    const context = episodes([...saturation("one"), reply]);
    const { seen, transition } = context;

    // 1. Saturated. The thread's job is found by escalating to `?originId=`.
    await waitFor(() => {
      expect(seen.at(-1)).toBe("evt_reply");
    });

    // 2. The queue drains under the cap with the reply still outstanding: the
    //    escalation parks holding "evt_reply is pending", which is true now.
    transition([reply]);
    await waitFor(() => {
      expect(context.escalations()).toBe(2);
    });

    // 3. The reply lands. The shared list empties, the card falls quiet — and
    //    the parked query is not refetched, because it is not active.
    transition([]);
    await waitFor(() => {
      expect(seen.at(-1)).toBeNull();
    });
    return context;
  }

  it("never re-asserts a job that finished while the escalation was parked", async () => {
    const { seen, transition, escalations } = await strandAStaleAnswer();
    const settled = seen.length;

    // The queue saturates again, on other threads' work only.
    transition(saturation("two"));
    await waitFor(() => {
      expect(escalations()).toBe(3);
    });
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(settled);
    });

    // Not on any render did the card go back to counting up a finished job.
    expect(seen.slice(settled)).not.toContain("evt_reply");
    expect(seen.at(-1)).toBeNull();
  });

  it("still escalates in the second episode, and finds what is genuinely outstanding", async () => {
    const { seen, transition, escalations } = await strandAStaleAnswer();

    // A new ask, buried behind a fresh saturation: disregarding the parked
    // answer must not cost the completeness the escalation exists for.
    const asked = jobFixture({
      eventId: "evt_asked_again",
      status: "pending",
      originId: THREAD,
      started: "2026-07-01T11:00:00.000Z",
    });
    transition([...saturation("two"), asked]);

    await waitFor(() => {
      expect(seen.at(-1)).toBe("evt_asked_again");
    });
    // One per episode, plus the refetch the drain's own invalidation issued
    // while the escalation was still active. Flat in the number of cards either
    // way — that is what `anchors/marginJobRequests.test.tsx` counts.
    expect(escalations()).toBe(3);
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
