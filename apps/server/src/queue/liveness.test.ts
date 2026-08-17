// SPEC.md §7's presence — the parked request, and nothing else (SERVER-112).
//
// Everything here drives the tracker through its one input, `observePark`, and
// an injected clock. There is nothing else to drive it with, which is the
// property under test as much as any assertion below: no heartbeat to send, no
// registration to keep fresh, nothing to reap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_PRESENCE_WINDOW_SECONDS, MAX_IDLE_TIMEOUT_SECONDS } from "@corpus/contract";
import { LANE_GRACE_MS, NOTHING_PARKED, createLaneTracker } from "./liveness.js";

const LANE = "th_resident";
const OTHER = "th_other";

let clock = 1_700_000_000_000;
const now = (): number => clock;
const advance = (ms: number): void => {
  clock += ms;
};

beforeEach(() => {
  clock = 1_700_000_000_000;
});

describe("the grace window", () => {
  // §7 fixes exactly one bound on the window — "the window is longer than a
  // rearm gap" — and the mechanism depends on it: a healthy listener un-parks
  // for a moment every time it re-parks, so a window inside that gap reads an
  // ordinary rearm as a departure. The rearm gap is bounded by the contract's
  // idle timeout, so this is the arithmetic, pinned.
  it("is longer than a rearm gap, and is the contract's one number", () => {
    expect(LANE_GRACE_MS).toBe(AGENT_PRESENCE_WINDOW_SECONDS * 1000);
    expect(LANE_GRACE_MS).toBeGreaterThan(MAX_IDLE_TIMEOUT_SECONDS * 1000);
    // Two whole park cycles: one wholly missed rearm is tolerated, two is a
    // departure.
    expect(LANE_GRACE_MS).toBe(MAX_IDLE_TIMEOUT_SECONDS * 1000 * 2);
  });
});

describe("liveness is the held request", () => {
  it("is not live before anything parks, and has no instant to show", () => {
    const tracker = createLaneTracker({ now });
    expect(tracker.isLive(LANE)).toBe(false);
    expect(tracker.presenceOf(LANE)).toEqual({ lane: LANE, live: false, since: null });
    tracker.close();
  });

  it("is live while the request is held, however long the window runs", () => {
    const tracker = createLaneTracker({ now });
    const release = tracker.observePark(LANE);

    advance(MAX_IDLE_TIMEOUT_SECONDS * 1000);
    expect(tracker.isLive(LANE)).toBe(true);
    // `since` is the instant the park began and does not advance under it: the
    // age of the evidence, not the length of the session.
    expect(tracker.presenceOf(LANE).since).toBe("2023-11-14T22:13:20Z");

    release();
    tracker.close();
  });

  it("stays live across the grace window after the request ends, and lapses past it", () => {
    const tracker = createLaneTracker({ now });
    tracker.observePark(LANE)();

    advance(LANE_GRACE_MS - 1);
    expect(tracker.isLive(LANE)).toBe(true);

    advance(1);
    expect(tracker.isLive(LANE)).toBe(false);
    // The evidence survives the verdict: the roster still says when this lane
    // was last heard from, which is what "designated, nobody listening" looks
    // like rather than "never designated".
    expect(tracker.presenceOf(LANE)).toEqual({
      lane: LANE,
      live: false,
      since: "2023-11-14T22:13:20Z",
    });
    tracker.close();
  });

  it("survives a rearm, which is a release and a park a moment apart", () => {
    const tracker = createLaneTracker({ now });
    const first = tracker.observePark(LANE);
    advance(MAX_IDLE_TIMEOUT_SECONDS * 1000);
    first();
    advance(50);
    const second = tracker.observePark(LANE);

    expect(tracker.isLive(LANE)).toBe(true);
    advance(LANE_GRACE_MS * 2);
    // Still held, so still live — the window never applies to a request in hand.
    expect(tracker.isLive(LANE)).toBe(true);
    second();
    tracker.close();
  });

  it("counts holds, so an overlapping rearm cannot take the lane down", () => {
    const tracker = createLaneTracker({ now });
    const first = tracker.observePark(LANE);
    const second = tracker.observePark(LANE);

    first();
    advance(LANE_GRACE_MS * 2);
    // A flag would have been cleared by the first release; the second hold is
    // still open, and the lane is still live.
    expect(tracker.isLive(LANE)).toBe(true);

    second();
    advance(LANE_GRACE_MS);
    expect(tracker.isLive(LANE)).toBe(false);
    tracker.close();
  });

  it("ignores a release called twice, so one park cannot decrement another's hold", () => {
    const tracker = createLaneTracker({ now });
    const first = tracker.observePark(LANE);
    const second = tracker.observePark(LANE);

    first();
    first();
    expect(tracker.isLive(LANE)).toBe(true);
    second();
    advance(LANE_GRACE_MS);
    expect(tracker.isLive(LANE)).toBe(false);
    tracker.close();
  });

  it("keeps lanes apart: one listener's presence says nothing about another's", () => {
    const tracker = createLaneTracker({ now });
    const release = tracker.observePark(LANE);

    expect(tracker.isLive(LANE)).toBe(true);
    expect(tracker.isLive(OTHER)).toBe(false);

    release();
    tracker.close();
  });

  it("restores a lapsed lane on the next park, with nothing to migrate", () => {
    const tracker = createLaneTracker({ now });
    tracker.observePark(LANE)();
    advance(LANE_GRACE_MS + 1);
    expect(tracker.isLive(LANE)).toBe(false);

    const back = tracker.observePark(LANE);
    expect(tracker.isLive(LANE)).toBe(true);
    expect(tracker.presenceOf(LANE).since).toBe("2023-11-14T22:29:20Z");
    back();
    tracker.close();
  });
});

describe("the workspace-wide aggregate", () => {
  it("says nobody is there before anything parks", () => {
    const tracker = createLaneTracker({ now });
    expect(tracker.presence()).toEqual({ live: false, since: null });
    tracker.close();
  });

  // CONTRACT-045: `QueueStatus.agent` is the roster's own verdict aggregated —
  // live iff some lane is, `since` the most recent of their instants — so the
  // console strip and the recipient picker cannot disagree.
  it("is live while any one lane is, and carries the most recent instant", () => {
    const tracker = createLaneTracker({ now });
    tracker.observePark(LANE)();
    advance(60_000);
    const held = tracker.observePark(OTHER);

    expect(tracker.presence()).toEqual({ live: true, since: "2023-11-14T22:14:20Z" });

    held();
    advance(LANE_GRACE_MS + 1);
    expect(tracker.presence()).toEqual({ live: false, since: "2023-11-14T22:14:20Z" });
    tracker.close();
  });

  it("says whether an agent is present, never how many", () => {
    const tracker = createLaneTracker({ now });
    const one = tracker.observePark(LANE);
    const two = tracker.observePark(OTHER);

    expect(tracker.presence().live).toBe(true);
    one();
    two();
    tracker.close();
  });
});

describe("the announcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A tracker on the fake timers' own clock, so the timer and `now` agree. */
  const trackerOnFakeClock = (
    onPresenceChanged: (lane: string) => void,
    onLapsed: (lane: string) => void,
  ) => createLaneTracker({ now: () => Date.now(), onPresenceChanged, onLapsed });

  it("announces every transition of a lane's row: park, release, lapse", () => {
    const changed: string[] = [];
    const lapsed: string[] = [];
    const tracker = trackerOnFakeClock(
      (lane) => changed.push(lane),
      (lane) => lapsed.push(lane),
    );

    const release = tracker.observePark(LANE);
    expect(changed).toEqual([LANE]);
    release();
    expect(changed).toEqual([LANE, LANE]);
    expect(lapsed).toEqual([]);

    vi.advanceTimersByTime(LANE_GRACE_MS);
    expect(lapsed).toEqual([LANE]);
    expect(changed).toEqual([LANE, LANE, LANE]);
    tracker.close();
  });

  it("announces a lapse once, however long the lane stays quiet", () => {
    const lapsed: string[] = [];
    const tracker = trackerOnFakeClock(
      () => undefined,
      (lane) => lapsed.push(lane),
    );
    tracker.observePark(LANE)();

    vi.advanceTimersByTime(LANE_GRACE_MS * 5);
    expect(lapsed).toEqual([LANE]);
    tracker.close();
  });

  it("announces a lapse per lane, at each lane's own deadline", () => {
    const lapsed: string[] = [];
    const tracker = trackerOnFakeClock(
      () => undefined,
      (lane) => lapsed.push(lane),
    );
    tracker.observePark(LANE)();
    vi.advanceTimersByTime(60_000);
    tracker.observePark(OTHER)();

    vi.advanceTimersByTime(LANE_GRACE_MS - 60_000);
    expect(lapsed).toEqual([LANE]);
    vi.advanceTimersByTime(60_000);
    expect(lapsed).toEqual([LANE, OTHER]);
    tracker.close();
  });

  it("does not announce a lapse for a lane that came back", () => {
    const lapsed: string[] = [];
    const tracker = trackerOnFakeClock(
      () => undefined,
      (lane) => lapsed.push(lane),
    );
    tracker.observePark(LANE)();
    vi.advanceTimersByTime(LANE_GRACE_MS - 1);
    const back = tracker.observePark(LANE);

    vi.advanceTimersByTime(LANE_GRACE_MS * 2);
    expect(lapsed).toEqual([]);
    back();
    tracker.close();
  });

  // The timer decides nothing: it announces. A tracker whose announcements are
  // shut off still answers every question the same way, which is what makes the
  // fallback safe to compute at claim time.
  it("still lapses for a reader after close, which only stops the announcing", () => {
    const lapsed: string[] = [];
    const tracker = trackerOnFakeClock(
      () => undefined,
      (lane) => lapsed.push(lane),
    );
    tracker.observePark(LANE)();
    tracker.close();

    vi.advanceTimersByTime(LANE_GRACE_MS * 3);
    expect(lapsed).toEqual([]);
    expect(tracker.isLive(LANE)).toBe(false);
  });
});

describe("a queue with no tracker bound", () => {
  // Not a stand-in for an unknown answer: such a queue is the one thing a park
  // would have reached, so "nothing parked" is a measurement over the whole
  // population rather than a claim about agents the server cannot see.
  it("observes no park and answers with the measurement", () => {
    expect(NOTHING_PARKED.isLive(LANE)).toBe(false);
    NOTHING_PARKED.observePark(LANE)();
    expect(NOTHING_PARKED.isLive(LANE)).toBe(false);
    expect(NOTHING_PARKED.presence()).toEqual({ live: false, since: null });
    expect(NOTHING_PARKED.presenceOf(LANE)).toEqual({ lane: LANE, live: false, since: null });
    NOTHING_PARKED.close();
  });
});
