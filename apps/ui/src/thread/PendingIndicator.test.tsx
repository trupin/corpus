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
  ELAPSED_AFTER_MS,
  LONGER_AFTER_MS,
  NO_AGENT_CLAUSE,
  PendingIndicator,
  pendingLabel,
  SLOW_AFTER_MS,
  waitingLabel,
  WAITING_TIERS,
  workingLabel,
  WORKING_TIERS,
  type PendingState,
} from "./PendingIndicator";

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

describe("pendingLabel", () => {
  it("routes each state to its own vocabulary", () => {
    expect(pendingLabel("working", 0, true)).toBe(WORKING_TIERS.fresh);
    expect(pendingLabel("waiting", 0, true)).toBe(WAITING_TIERS.fresh);
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
  props: { readonly since: string; readonly state: PendingState },
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
