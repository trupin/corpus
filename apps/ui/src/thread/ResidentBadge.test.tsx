/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readerTransport } from "../testing/readerFixture";
import { ResidentBadge } from "./ResidentBadge";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function designated(overrides: Partial<AgentLane> = {}): AgentLane {
  return {
    lane: "th_root",
    resident: { name: "researcher", docId: "doc_agentdef" },
    live: true,
    // Relative to now: `isAgentPresent` expires evidence that has aged past the
    // grace window, so a fixed instant would be lapsed by the time this runs.
    since: new Date(Date.now() - 60_000).toISOString(),
    summary: "reading the policy",
    origin: { id: "th_root", title: "Q3 planning" },
    ...overrides,
  };
}

function renderBadge(
  threadId: string,
  lanes: readonly AgentLane[],
): { readonly container: HTMLElement } {
  const harness = createCorpusTestHarness({ fetch: readerTransport({ lanes }).fetch });
  const Wrapped = (): ReactElement => (
    <harness.Wrapper>
      <ResidentBadge threadId={threadId} />
    </harness.Wrapper>
  );
  return render(<Wrapped />);
}

const badge = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>(".t-resident");

describe("ResidentBadge", () => {
  it("wears the resident's name, its liveness and the line beside it", async () => {
    const { container } = renderBadge("th_root", [designated()]);

    await waitFor(() => {
      expect(badge(container)).not.toBeNull();
    });
    expect(badge(container)?.dataset["residentLiveness"]).toBe("live");
    expect(badge(container)?.textContent).toContain("researcher");
    expect(badge(container)?.textContent).toContain("reading the policy");
    expect(container.querySelector(".lane-dot.live")).not.toBeNull();
  });

  /**
   * The dot is decoration; the fact is in words. A surface that left liveness to
   * a colour would be unreadable to a screen reader and to a third of the people
   * who can see it, so the badge's title carries the whole line too — the head
   * is one row and a lane summary is bounded at 200 characters, not short.
   */
  it("keeps the liveness readable without a pointer and without colour", async () => {
    const { container } = renderBadge("th_root", [designated({ live: false, summary: null })]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentLiveness"]).toBe("lapsed");
    });
    expect(badge(container)?.getAttribute("title")).toContain(
      "the orchestrator will answer until it returns",
    );
    expect(badge(container)?.textContent).toContain(
      "the orchestrator will answer until it returns",
    );
    expect(container.querySelector(".lane-dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  /**
   * The overwhelming majority of conversations. §7 names a lane after its
   * designated root thread, so no row means no resident, and the head must look
   * exactly as it did before this feature existed.
   */
  it("draws nothing at all on a conversation the roster does not name", async () => {
    const { container } = renderBadge("th_plain", [designated()]);

    await waitFor(() => {
      expect(container.querySelector(".lane-dot")).toBeNull();
    });
    expect(badge(container)).toBeNull();
  });

  /**
   * UI-098's rule at the board's grain. A badge rendered before `GET /api/agents`
   * has answered would be asserting something about a lane nobody has described
   * — in either direction.
   */
  it("says nothing while the roster is still in flight", () => {
    const { container } = renderBadge("th_root", [designated()]);
    expect(badge(container)).toBeNull();
  });

  /**
   * Departure without a refetch. `isAgentPresent` expires a `live: true` whose
   * evidence has aged past the grace window, and the badge re-evaluates it on
   * its own tick — otherwise a green dot outlives the agent it describes until
   * some unrelated invalidation happens by.
   */
  it("stops claiming somebody is there once the evidence has gone stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    const { container } = renderBadge("th_root", [designated()]);

    await vi.waitFor(() => {
      expect(badge(container)?.dataset["residentLiveness"]).toBe("live");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(badge(container)?.dataset["residentLiveness"]).toBe("lapsed");
  });
});

describe("the words the badge uses", () => {
  /**
   * They are `laneRow`'s, which is what the recipient picker renders — so the
   * board and the composer describe one lane identically, including the awkward
   * cases nobody thinks to keep in step.
   */
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the conversation's title when the designation names no agent", async () => {
    const { container } = renderBadge("th_root", [designated({ resident: null })]);

    await waitFor(() => {
      expect(badge(container)?.textContent).toContain("Q3 planning");
    });
  });

  it("says a lane nothing has ever parked on is waiting for one", async () => {
    const { container } = renderBadge("th_root", [
      designated({ live: false, since: null, summary: null }),
    ]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentLiveness"]).toBe("waiting");
    });
    expect(badge(container)?.textContent).toContain("no listener yet");
  });
});
