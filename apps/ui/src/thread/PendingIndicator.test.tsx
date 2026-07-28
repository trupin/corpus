/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELAPSED_AFTER_MS,
  humanizeElapsed,
  LONGER_AFTER_MS,
  PendingIndicator,
  SLOW_AFTER_MS,
  workingLabel,
  WORKING_TIERS,
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

describe("humanizeElapsed", () => {
  it("reads as a duration at every scale", () => {
    expect(humanizeElapsed(0)).toBe("0m");
    expect(humanizeElapsed(59 * 60_000)).toBe("59m");
    expect(humanizeElapsed(2 * 3_600_000 + 5 * 60_000)).toBe("2h 05m");
    expect(humanizeElapsed(26 * 3_600_000)).toBe("1d 02h");
  });
});

describe("PendingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /**
   * The whole point of the tier: reloading mid-wait must not reset the message.
   * Elapsed is computed from the requesting turn's timestamp, so a component
   * mounted fifteen minutes late already says so on its first paint.
   */
  it("computes elapsed from the turn's timestamp, not from mount", () => {
    vi.setSystemTime(new Date("2026-07-19T10:20:00.000Z"));
    const { container } = render(<PendingIndicator since="2026-07-19T10:05:00.000Z" />);
    expect(container.querySelector(".working")?.textContent).toBe("still working — 15m");
    expect(container.querySelector(".working-dot")).not.toBeNull();
  });

  it("crosses each threshold as time passes", () => {
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = render(<PendingIndicator since="2026-07-19T10:05:00.000Z" />);
    const text = (): string => container.querySelector(".working")?.textContent ?? "";
    expect(text()).toBe(WORKING_TIERS.fresh);

    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
    });
    expect(text()).toBe(WORKING_TIERS.slow);

    act(() => {
      vi.advanceTimersByTime(LONGER_AFTER_MS);
    });
    expect(text()).toBe(WORKING_TIERS.longer);

    act(() => {
      vi.advanceTimersByTime(ELAPSED_AFTER_MS);
    });
    expect(text()).toContain("still working — ");
  });

  it("claims no duration at all for an unparseable timestamp", () => {
    const { container } = render(<PendingIndicator since="not a date" />);
    expect(container.querySelector(".working")?.textContent).toBe(WORKING_TIERS.fresh);
  });
});
