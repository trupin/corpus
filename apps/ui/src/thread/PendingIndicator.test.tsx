/** @vitest-environment jsdom */
import type { QueueStatus } from "@corpus/contract";
import { humanizeElapsed, QUEUE_KEY } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveQueue, QUIET_QUEUE, readerTransport } from "../testing/readerFixture";
import {
  DEFERRED_TIERS,
  DEFERRED_TIERS_UNNAMED,
  deferredLabel,
  ELAPSED_AFTER_MS,
  LANE_ABSENT_CLAUSE,
  laneAwayClause,
  laneWaitingLabel,
  laneWorkingLabel,
  LONGER_AFTER_MS,
  NO_AGENT_CLAUSE,
  PendingIndicator,
  pendingLabel,
  SLOW_AFTER_MS,
  waitingLabel,
  WAITING_TIERS,
  workingLabel,
  WORKING_TIERS,
  type PendingLane,
  type PendingState,
} from "./PendingIndicator";

/** A lane as `laneRow` hands it over — the composer's own vocabulary. */
function lane(liveness: PendingLane["liveness"], name = "researcher"): PendingLane {
  return { lane: "th_root", name, liveness };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("workingLabel", () => {
  it("escalates at 45 s, 3 m and 15 m and never claims progress", () => {
    expect(workingLabel(0)).toBe(WORKING_TIERS.fresh);
    expect(workingLabel(SLOW_AFTER_MS - 1)).toBe(WORKING_TIERS.fresh);
    expect(workingLabel(SLOW_AFTER_MS)).toBe(WORKING_TIERS.slow);
    expect(workingLabel(LONGER_AFTER_MS)).toBe(WORKING_TIERS.longer);
    expect(workingLabel(ELAPSED_AFTER_MS)).toBe("still working — 15m");
    expect(workingLabel(90 * 60_000)).toBe("still working — 1h 30m");
  });
});

/**
 * SPEC.md §8's rider (signed 2026-08-12): a queued, unclaimed request "reads as
 * **waiting to be picked up**, distinct in wording from a request being worked".
 * The tiers below are that distinction at every threshold — including the one
 * that used to read "still working — longer than usual" about work that had
 * never started.
 */
describe("waitingLabel", () => {
  it("escalates on the same clock and never claims the agent is working", () => {
    expect(waitingLabel(0, true)).toBe(WAITING_TIERS.fresh);
    expect(waitingLabel(SLOW_AFTER_MS - 1, true)).toBe(WAITING_TIERS.fresh);
    expect(waitingLabel(SLOW_AFTER_MS, true)).toBe(WAITING_TIERS.slow);
    expect(waitingLabel(LONGER_AFTER_MS, true)).toBe(WAITING_TIERS.longer);
    expect(waitingLabel(ELAPSED_AFTER_MS, true)).toBe("still waiting — 15m");
    expect(waitingLabel(90 * 60_000, true)).toBe("still waiting — 1h 30m");
  });

  it("never says the word the row is not entitled to", () => {
    for (const ms of [0, SLOW_AFTER_MS, LONGER_AFTER_MS, ELAPSED_AFTER_MS, 3_600_000]) {
      for (const present of [true, false]) {
        expect(waitingLabel(ms, present)).not.toContain("working");
      }
    }
  });

  /**
   * Absence is named from three minutes on and not before: a claim takes a
   * moment, and shouting about an empty roster for a request posted a second ago
   * would be the same unevidenced urgency in the other direction.
   */
  it("names an empty roster only once the wait is worth explaining", () => {
    expect(waitingLabel(0, false)).toBe(WAITING_TIERS.fresh);
    expect(waitingLabel(SLOW_AFTER_MS, false)).toBe(WAITING_TIERS.slow);
    expect(waitingLabel(LONGER_AFTER_MS, false)).toBe(WAITING_TIERS.absent);
    expect(waitingLabel(LONGER_AFTER_MS, false)).toContain(NO_AGENT_CLAUSE);
  });

  /** Past 15 m the wait's length and its reason are both worth saying. */
  it("keeps the elapsed figure when it also reports an empty roster", () => {
    expect(waitingLabel(22 * 60_000, false)).toBe(`still waiting — 22m, ${NO_AGENT_CLAUSE}`);
    expect(waitingLabel(22 * 60_000, true)).toBe("still waiting — 22m");
  });
});

/**
 * The third vocabulary (UI-115). §7: *"Nothing refused it: the agent deferred
 * because it saw, not because it was blocked."* So the row has to say the
 * request was **seen**, say what it is parked **on**, and stay calm about it —
 * a deferral that lasts is a document somebody has had open, not breakage.
 */
describe("deferredLabel", () => {
  const ON = { docId: "doc_policy", title: "The reimbursement policy" };

  it("names the document, and says the request was seen rather than ignored", () => {
    for (const ms of [0, SLOW_AFTER_MS, LONGER_AFTER_MS, ELAPSED_AFTER_MS]) {
      const said = deferredLabel(ms, ON);
      expect(said).toContain("paused");
      expect(said).toContain(ON.title);
      // Never the waiting ladder's words: "waiting to be picked up" is the
      // false inference this state exists to prevent.
      expect(said).not.toContain("picked up");
      expect(said).not.toContain("working");
    }
  });

  it("escalates in precision and not in volume", () => {
    expect(deferredLabel(0, ON)).toBe(`${DEFERRED_TIERS.fresh} ${ON.title}`);
    expect(deferredLabel(SLOW_AFTER_MS - 1, ON)).toBe(`${DEFERRED_TIERS.fresh} ${ON.title}`);
    expect(deferredLabel(SLOW_AFTER_MS, ON)).toBe(`${DEFERRED_TIERS.slow} ${ON.title}`);
    // From here it says what ends it — the actionable half, and the whole reason
    // this state reads differently from `waiting`.
    expect(deferredLabel(LONGER_AFTER_MS, ON)).toBe(`${DEFERRED_TIERS.longer} ${ON.title}`);
    expect(deferredLabel(22 * 60_000, ON)).toBe(
      `still paused for 22m — it resumes when you finish editing ${ON.title}`,
    );
    // No tier reaches for the register the waiting ladder keeps for an absent
    // agent: nothing here is a fault (SPEC.md §7).
    for (const ms of [0, SLOW_AFTER_MS, LONGER_AFTER_MS, 22 * 60_000]) {
      expect(deferredLabel(ms, ON)).not.toContain(NO_AGENT_CLAUSE);
      expect(deferredLabel(ms, ON)).not.toContain("longer than usual");
    }
  });

  it("falls back to the id, and then to a sentence naming no document", () => {
    expect(deferredLabel(0, { docId: "doc_policy", title: null })).toContain("doc_policy");
    const unnamed = deferredLabel(0, { docId: null, title: null });
    expect(unnamed).toBe(DEFERRED_TIERS_UNNAMED.fresh);
    // A clause short rather than a clause with a hole in it.
    expect(unnamed).not.toContain("“”");
    expect(deferredLabel(LONGER_AFTER_MS, { docId: null, title: null })).toBe(
      DEFERRED_TIERS_UNNAMED.longer,
    );
    expect(deferredLabel(22 * 60_000, { docId: null, title: null })).toBe(
      "still paused for 22m — it resumes when that editing finishes",
    );
  });
});

describe("pendingLabel", () => {
  it("routes each state to its own vocabulary", () => {
    expect(pendingLabel("working", 0, true)).toBe(WORKING_TIERS.fresh);
    expect(pendingLabel("waiting", 0, true)).toBe(WAITING_TIERS.fresh);
    expect(pendingLabel("deferred", 0, true, undefined, { docId: "doc_a", title: "Notes" })).toBe(
      `${DEFERRED_TIERS.fresh} Notes`,
    );
  });

  /**
   * The deferral is the most specific true thing about the wait and the only one
   * the reader can end, so it is said even where a lane could be named — naming
   * the resident would answer a question nobody is asking about work that is
   * already claimed.
   */
  it("prefers the deferral to the lane's own wording", () => {
    const said = pendingLabel("deferred", 0, true, lane("live"), {
      docId: "doc_a",
      title: "Notes",
    });
    expect(said).toBe(`${DEFERRED_TIERS.fresh} Notes`);
    expect(said).not.toContain("researcher");
  });

  it("still says it is paused when nothing named the document", () => {
    expect(pendingLabel("deferred", 0, true)).toBe(DEFERRED_TIERS_UNNAMED.fresh);
  });

  /**
   * The rider's other half: "the elapsed clock still runs from when the request
   * was written — the wait is the wait, whoever is or is not holding it". So the
   * two vocabularies must cross their thresholds at the same instants; a claim
   * changes the words and never the clock.
   */
  it("crosses its thresholds at the same instants in both states", () => {
    const tier = (state: PendingState, ms: number): string => pendingLabel(state, ms, true);
    for (const ms of [SLOW_AFTER_MS, LONGER_AFTER_MS, ELAPSED_AFTER_MS]) {
      expect(tier("working", ms - 1)).not.toBe(tier("working", ms));
      expect(tier("waiting", ms - 1)).not.toBe(tier("waiting", ms));
    }
  });
});

/**
 * SPEC.md §7's resident paragraphs, in §8's row (UI-109). The rule under every
 * case here is one sentence: name the resident for what the resident is
 * actually doing, and for nothing else.
 */
describe("the lane's own wording", () => {
  describe("laneAwayClause", () => {
    it("tells a resident that left from one that never arrived, and says what happens either way", () => {
      expect(laneAwayClause(lane("lapsed"))).toBe(`researcher is away — ${LANE_ABSENT_CLAUSE}`);
      expect(laneAwayClause(lane("waiting"))).toBe(
        `researcher is not running — ${LANE_ABSENT_CLAUSE}`,
      );
    });

    /**
     * **The defect UI-175 exists for.** This clause read *"the agent will pick
     * this up"* until v0.24.0 — true under §7's fallback, and false since
     * v0.23.0 removed it. It was showing on the surface a person reads *while
     * they are waiting*, which is the worst place in the product to promise an
     * answer that is not coming.
     */
    it("promises nobody else, because since v0.23.0 there is nobody else", () => {
      for (const state of ["lapsed", "waiting"] as const) {
        const said = laneAwayClause(lane(state)) ?? "";
        expect(said).not.toContain("will pick this up");
        expect(said).not.toMatch(/the agent will|orchestrator will/u);
        // What it says instead: waiting is what happens next, so the silence is
        // not read as the message having been lost.
        expect(said).toContain("nothing will answer until it starts");
      }
    });

    /**
     * It names the fact and stops. Not why the listener is gone — this row
     * cannot know — and not an instruction to start one, which the product
     * gives nobody a way to follow.
     */
    it("neither diagnoses the absence nor tells anybody to fix it", () => {
      const said = laneAwayClause(lane("lapsed")) ?? "";
      expect(said).not.toMatch(/crash|restart|start it|run `|try again/iu);
    });

    it("has nothing to say about a lane somebody is on, or one it has not heard about", () => {
      expect(laneAwayClause(lane("live"))).toBeNull();
      expect(laneAwayClause(lane("unknown"))).toBeNull();
    });
  });

  describe("laneWorkingLabel", () => {
    it("escalates on the same clock, with the resident named throughout", () => {
      expect(laneWorkingLabel(0, lane("live"))).toBe("researcher is working…");
      expect(laneWorkingLabel(SLOW_AFTER_MS, lane("live"))).toBe("researcher is still working…");
      expect(laneWorkingLabel(LONGER_AFTER_MS, lane("live"))).toBe(
        "researcher is still working — longer than usual",
      );
      expect(laneWorkingLabel(22 * 60_000, lane("live"))).toBe("researcher is still working — 22m");
    });
  });

  describe("laneWaitingLabel", () => {
    it("waits *for* a resident that is there", () => {
      expect(laneWaitingLabel(0, lane("live"))).toBe("queued — waiting for researcher");
      expect(laneWaitingLabel(SLOW_AFTER_MS, lane("live"))).toBe("still waiting for researcher");
      expect(laneWaitingLabel(LONGER_AFTER_MS, lane("live"))).toBe(
        "still waiting — researcher has not picked this up yet",
      );
      expect(laneWaitingLabel(22 * 60_000, lane("live"))).toBe(
        "still waiting for researcher — 22m",
      );
    });

    /**
     * §8's rider of 2026-08-13 said a message on a lapsed lane reads as waiting
     * "until something claims it — the resident returning, or the orchestrator
     * after the fallback". **The rider was amended on 2026-08-25 and the second
     * half of that is gone**: the resident returning is the only way now.
     *
     * The timing is unchanged and is still the interesting part. This says the
     * lane is absent from the *first* tier, where the workspace-grained row
     * waits three minutes — because the roster has already told us this listener
     * is gone, and withholding a fact we hold would be its own dishonesty. That
     * argument got stronger, not weaker: the wait is now open-ended.
     */
    it("says a lapsed lane is away, and that nothing else is coming", () => {
      expect(laneWaitingLabel(0, lane("lapsed"))).toBe(
        "waiting — researcher is away — nothing will answer until it starts",
      );
      expect(laneWaitingLabel(SLOW_AFTER_MS, lane("lapsed"))).toBe(
        "still waiting — researcher is away — nothing will answer until it starts",
      );
      expect(laneWaitingLabel(22 * 60_000, lane("lapsed"))).toBe(
        "still waiting — 22m, researcher is away — nothing will answer until it starts",
      );
    });

    it("never claims a wait on any lane is somebody working", () => {
      for (const liveness of ["live", "lapsed", "waiting"] as const) {
        for (const ms of [0, SLOW_AFTER_MS, LONGER_AFTER_MS, ELAPSED_AFTER_MS, 3_600_000]) {
          expect(laneWaitingLabel(ms, lane(liveness))).not.toContain("working");
        }
      }
    });
  });

  describe("pendingLabel with a lane", () => {
    it("names the resident on a live lane, in both vocabularies", () => {
      expect(pendingLabel("working", 0, true, lane("live"))).toBe("researcher is working…");
      expect(pendingLabel("waiting", 0, true, lane("live"))).toBe(
        "queued — waiting for researcher",
      );
    });

    /**
     * The honesty rule this feature turns on. Past the grace window a lane's
     * pending events become visible to the orchestrator's unscoped claim, so a
     * *claimed* event on a lapsed lane may be the orchestrator's work — and
     * "researcher is working" would be exactly the unevidenced claim UI-097
     * removed. Waiting still names them, because the wait genuinely is theirs.
     */
    it("will not say an away resident is working, though it will say one is awaited", () => {
      expect(pendingLabel("working", 0, true, lane("lapsed"))).toBe(WORKING_TIERS.fresh);
      expect(pendingLabel("working", 0, true, lane("waiting"))).toBe(WORKING_TIERS.fresh);
      expect(pendingLabel("waiting", 0, true, lane("lapsed"))).toContain("researcher is away");
    });

    /** UI-098's rule: a lane we have not heard about is not a lane we may describe. */
    it("says nothing about a lane the roster has not answered for", () => {
      expect(pendingLabel("working", 0, true, lane("unknown"))).toBe(WORKING_TIERS.fresh);
      expect(pendingLabel("waiting", LONGER_AFTER_MS, false, lane("unknown"))).toBe(
        WAITING_TIERS.absent,
      );
    });

    /**
     * Not a special case: `laneName` calls the orchestrator's lane "agent",
     * which is the word the default tiers already use — so the general rule and
     * the fallback agree there rather than one overriding the other.
     */
    it("leaves the orchestrator's lane to the tiers that already name it", () => {
      const orchestrator: PendingLane = { lane: "orchestrator", name: "agent", liveness: "live" };
      expect(pendingLabel("working", 0, true, orchestrator)).toBe(WORKING_TIERS.fresh);
      expect(pendingLabel("waiting", LONGER_AFTER_MS, false, orchestrator)).toBe(
        WAITING_TIERS.absent,
      );
    });

    /**
     * `QueueStatus.agent` is the workspace's answer and a lane's liveness is the
     * roster's; CONTRACT-053 lets them disagree for a grace window, so a row that
     * merged them could state both at once. It states one.
     */
    it("never merges the workspace clause into a lane's sentence", () => {
      for (const liveness of ["live", "lapsed", "waiting"] as const) {
        for (const ms of [LONGER_AFTER_MS, ELAPSED_AFTER_MS]) {
          expect(pendingLabel("waiting", ms, false, lane(liveness))).not.toContain(NO_AGENT_CLAUSE);
        }
      }
    });

    /** The lane changes the words and never the clock (§8's rider). */
    it("crosses its thresholds at the same instants as the unnamed row", () => {
      for (const ms of [SLOW_AFTER_MS, LONGER_AFTER_MS, ELAPSED_AFTER_MS]) {
        for (const state of ["working", "waiting"] as const) {
          expect(pendingLabel(state, ms - 1, true, lane("live"))).not.toBe(
            pendingLabel(state, ms, true, lane("live")),
          );
        }
      }
    });
  });
});

describe("humanizeElapsed", () => {
  it("reads as a duration at every scale", () => {
    expect(humanizeElapsed(0)).toBe("0m");
    expect(humanizeElapsed(59 * 60_000)).toBe("59m");
    expect(humanizeElapsed(2 * 3_600_000 + 5 * 60_000)).toBe("2h 05m");
    expect(humanizeElapsed(26 * 3_600_000)).toBe("1d 02h");
  });
});

/**
 * Rendered with the kit data layer mounted, because the row reads
 * `QueueStatus.agent` (CONTRACT-045) rather than guessing at presence. The
 * status is seeded into the cache instead of awaited off the transport: these
 * tests run on fake timers to cross the thresholds, and what they are about is
 * the wording, not the fetch.
 */
function renderIndicator(
  props: {
    readonly since: string;
    readonly state: PendingState;
    readonly lane?: PendingLane;
    readonly deferred?: { readonly docId: string | null; readonly title: string | null };
  },
  queue: QueueStatus = QUIET_QUEUE,
): { readonly container: HTMLElement } {
  // `staleTime: Infinity` is the app's own default (`app/queryClient.ts`), and
  // here it also keeps the seeded answer from being refetched under fake timers
  // — these tests advance the clock by twenty minutes at a stroke.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const harness = createCorpusTestHarness({ fetch: readerTransport({ queue }).fetch, queryClient });
  harness.queryClient.setQueryData(QUEUE_KEY, queue);
  const Wrapped = (): ReactElement => (
    <harness.Wrapper>
      <PendingIndicator {...props} />
    </harness.Wrapper>
  );
  return render(<Wrapped />);
}

describe("PendingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const text = (container: HTMLElement): string =>
    container.querySelector(".working")?.textContent ?? "";

  /**
   * The whole point of the tier: reloading mid-wait must not reset the message.
   * Elapsed is computed from the requesting turn's timestamp, so a component
   * mounted fifteen minutes late already says so on its first paint.
   */
  it("computes elapsed from the turn's timestamp, not from mount", () => {
    vi.setSystemTime(new Date("2026-07-19T10:20:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "working",
    });
    expect(text(container)).toBe("still working — 15m");
    expect(container.querySelector(".working-dot")).not.toBeNull();
  });

  it("crosses each threshold as time passes", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "working",
    });
    expect(text(container)).toBe(WORKING_TIERS.fresh);

    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
    });
    expect(text(container)).toBe(WORKING_TIERS.slow);

    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text(container)).toBe(WORKING_TIERS.longer);

    act(() => {
      vi.advanceTimersByTime(ELAPSED_AFTER_MS);
    });
    expect(text(container)).toContain("still working — ");
  });

  /**
   * The rendered deferral (UI-115). The row says which state it is in on
   * `data-pending-state`, which is what a stylesheet and a spec ask — and the
   * **dot stays the queued one**, because the dot answers "is anything being
   * worked" and the answer is still no. A third shape would need a sentence to
   * explain it, and the sentence is already there.
   */
  it("says a parked request is paused, names what on, and keeps the queued dot", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "deferred",
      deferred: { docId: "doc_policy", title: "The reimbursement policy" },
    });
    expect(text(container)).toBe(`${DEFERRED_TIERS.fresh} The reimbursement policy`);
    expect(container.querySelector(".queued-dot")).not.toBeNull();
    expect(container.querySelector(".working-dot")).toBeNull();
    expect(container.querySelector(".working")?.getAttribute("data-pending-state")).toBe(
      "deferred",
    );

    // It goes on saying the same calm thing as the clock runs, and picks up the
    // clause that says who can end it.
    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text(container)).toBe(`${DEFERRED_TIERS.longer} The reimbursement policy`);
  });

  /**
   * The rendered half of the lane rule, and the attribute a spec asks: the row
   * says which lane it is speaking about, or carries no such attribute when it
   * is speaking about none.
   */
  it("names the resident on the row itself, and marks which lane it means", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "working",
      lane: lane("live"),
    });
    expect(text(container)).toBe("researcher is working…");
    expect(container.querySelector(".working")?.getAttribute("data-pending-lane")).toBe("th_root");
  });

  it("marks no lane, and reads exactly as before, with none to speak of", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "working",
    });
    expect(text(container)).toBe(WORKING_TIERS.fresh);
    expect(container.querySelector(".working")?.hasAttribute("data-pending-lane")).toBe(false);
  });

  it("claims no duration at all for an unparseable timestamp", () => {
    const { container } = renderIndicator({ since: "not a date", state: "working" });
    expect(text(container)).toBe(WORKING_TIERS.fresh);
  });

  /**
   * The bug UI-097 is filed for: post to an agent that is not running and the
   * thread said "agent is working…", escalating. Nothing is working.
   */
  it("says an unclaimed request is waiting, and draws no pulsing dot", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:10.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "waiting",
    });
    expect(text(container)).toBe(WAITING_TIERS.fresh);
    expect(container.querySelector(".working-dot")).toBeNull();
    expect(container.querySelector(".queued-dot")).not.toBeNull();
    expect(container.querySelector(".working")?.getAttribute("data-pending-state")).toBe("waiting");
  });

  it("escalates a wait into the reason for it when nobody is parked", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator({
      since: "2026-07-19T10:05:00.000Z",
      state: "waiting",
    });
    expect(text(container)).toBe(WAITING_TIERS.fresh);

    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text(container)).toBe(WAITING_TIERS.absent);
  });

  it("does not blame an absent agent when one is parked", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator(
      { since: "2026-07-19T10:05:00.000Z", state: "waiting" },
      liveQueue("2026-07-19T10:04:00.000Z"),
    );

    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text(container)).toBe(WAITING_TIERS.longer);
    expect(text(container)).not.toContain(NO_AGENT_CLAUSE);
  });

  /**
   * `isAgentPresent` expires a `live: true` whose evidence has aged past the
   * grace window, and this row re-evaluates it on its own tick — so a verdict
   * fetched before the agent walked away does not sit here for the rest of the
   * session. A client may let a verdict expire; it may never manufacture one.
   */
  it("lets a stale presence verdict expire on its own tick", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderIndicator(
      { since: "2026-07-19T10:05:00.000Z", state: "waiting" },
      liveQueue("2026-07-19T10:04:00.000Z"),
    );

    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text(container)).toBe(WAITING_TIERS.longer);

    // Past twice the idle timeout with no fresher observation: the agent has
    // gone, and nothing new arrived to say so.
    act(() => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(text(container)).toContain(NO_AGENT_CLAUSE);
  });
});
