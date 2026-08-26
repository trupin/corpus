/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { GENERAL_RESIDENT_LABEL, MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE } from "@corpus/kit";
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
    resident: { name: "researcher", docId: "doc_agentdef", weight: null, designationId: null },
    live: true,
    // Relative to now: `isAgentPresent` expires evidence that has aged past the
    // grace window, so a fixed instant would be lapsed by the time this runs.
    since: new Date(Date.now() - 60_000).toISOString(),
    pending: 0,
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
    expect(badge(container)?.getAttribute("title")).toContain("no listener right now");
    expect(badge(container)?.textContent).toContain("no listener right now");
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

/**
 * §7's three residents, on the surface that shows one of them at a time. The
 * badge has to tell them apart without inventing a name for the one that has
 * none (CONTRACT-061) and without any of them reading as *no resident*.
 */
describe("the three shapes a resident has", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const GENERAL: AgentLane = designated({
    resident: { name: null, docId: null, weight: null, designationId: null },
  });

  it("names a profiled resident, and says so", async () => {
    const { container } = renderBadge("th_root", [designated()]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentKind"]).toBe("profiled");
    });
    expect(badge(container)?.textContent).toContain("researcher");
  });

  /**
   * The user's reported case, one surface on. A general resident is real and
   * owns this conversation, so the badge draws — and what it draws is a role,
   * never a word sitting where a profile name goes.
   */
  it("shows a general resident as a role rather than as a name", async () => {
    const { container } = renderBadge("th_root", [GENERAL]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentKind"]).toBe("general");
    });
    expect(container.querySelector(".t-resident-kind")?.textContent).toBe(GENERAL_RESIDENT_LABEL);
    expect(container.querySelector(".t-resident-name")).toBeNull();
    // Not "agent", not "general", and not the conversation's own title — which
    // is what a *list* of lanes names it by, and would say nothing here.
    expect(badge(container)?.textContent).not.toContain("Q3 planning");
  });

  it("does not read a general resident as no resident at all", async () => {
    const { container } = renderBadge("th_root", [GENERAL]);

    await waitFor(() => {
      expect(badge(container)).not.toBeNull();
    });
    // The badge exists, has a dot, and says who is listening — the whole
    // difference from a conversation the roster does not name.
    expect(container.querySelector(".lane-dot")).not.toBeNull();
    expect(badge(container)?.textContent).toContain("reading the policy");
  });

  /**
   * SPEC.md §7: a profile that goes after designation does not end the
   * designation — "the missing profile is reported rather than silently
   * substituted". The report is here, and it is not the general state.
   *
   * The ways in are renamed, deleted, or moved out of `.claude/agents/`
   * (`MISSING_PROFILE_CAUSES`). **Archiving is not one of them** — an archived
   * agent-def still resolves — so a badge reading this for an archived profile
   * would be reporting a miss that did not happen.
   *
   * **At row width, with the sentence on the title** (UI-124). The badge is one
   * line in a conversation's head and the whole note clipped there — 499px of
   * text in a 263px box, measured. `mark` and `note` are two renderings of one
   * fact off `LaneRow.kind`, so this is the picker's rule applied to a surface
   * that is also a row, and not a second wording of the claim.
   */
  it("reports a profile that has gone, still naming the resident", async () => {
    const { container } = renderBadge("th_root", [
      designated({
        resident: { name: "researcher", docId: null, weight: null, designationId: null },
      }),
    ]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentKind"]).toBe("profile-gone");
    });
    expect(container.querySelector(".t-resident-name")?.textContent).toBe("researcher");
    expect(container.querySelector(".t-resident-note")?.textContent).toBe(MISSING_PROFILE_MARK);
    // Revealed whole rather than lost (SHARED-057): the sentence is on the
    // title, readable without a pointer being the reason the mark is beside it.
    expect(badge(container)?.getAttribute("title")).toContain(MISSING_PROFILE_NOTE);
  });

  it("says nothing about a profile on a resident that never had one", async () => {
    const { container } = renderBadge("th_root", [GENERAL]);

    await waitFor(() => {
      expect(badge(container)?.dataset["residentKind"]).toBe("general");
    });
    expect(container.querySelector(".t-resident-note")).toBeNull();
  });
});
