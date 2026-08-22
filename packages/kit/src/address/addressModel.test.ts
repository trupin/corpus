import { describe, expect, it } from "vitest";
import {
  laneRow,
  unknownLaneRow,
  MISSING_PROFILE_MARK,
  ORCHESTRATOR_LABEL,
} from "../recipient/laneRows.js";
import {
  RECIPIENT_REFUSED_STATEMENT,
  RECIPIENT_UNKNOWN_STATEMENT,
} from "../recipient/statement.js";
import type { ComposerRecipient } from "../recipient/useComposerRecipient.js";
import type { ComposerWeight } from "../weight/weightChoice.js";
import {
  composerAddress,
  residentWeightSentence,
  weightLabel,
  ADDRESSED_TO,
  LAUNCH_WEIGHT_CLAUSE,
  NOBODY_ASKED,
} from "./addressModel.js";
import type { AgentLane } from "@corpus/contract";

/**
 * The derivation behind every composer's address line (UI-126) — tested pure,
 * because the two rules that matter most here are about **wording** and about
 * **what is withheld from the wire**, and neither should need a render:
 *
 *   - SPEC.md §10, rider signed 2026-08-19: a composer addressing a resident's
 *     lane offers no weight and names the resident's, and a standing choice is
 *     **not sent** — it is not made, rather than silently discarded.
 *   - SPEC.md §10's floor: a send that will not reach the agent has nothing to
 *     weigh, so nothing is offered and nothing is stated.
 */

const NOW = new Date().toISOString();

const ORCHESTRATOR: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: NOW,
  summary: null,
  origin: null,
};

function residentLane(overrides: Partial<NonNullable<AgentLane["resident"]>> = {}): AgentLane {
  return {
    lane: "th_a",
    resident: { name: "Ana", docId: "doc_ana", weight: "heavy", ...overrides },
    live: true,
    since: NOW,
    summary: "reviewing the draft",
    origin: { id: "th_a", title: "The claims conversation" },
  };
}

const LEVELS = [
  { label: "Small and mechanical", key: "light" },
  { label: "Standard", key: "standard" },
  { label: "Heavy or judgment-laden", key: "heavy" },
] as const;

function recipientOf(
  lanes: readonly AgentLane[] | undefined,
  effective: string | undefined,
  overrides: Partial<ComposerRecipient> = {},
): ComposerRecipient {
  const chosen = overrides.chosen;
  return {
    rows: lanes?.map((lane) => laneRow(lane, new Date())),
    computed: effective,
    chosen: undefined,
    effective,
    overridden: false,
    choose: () => undefined,
    request: chosen === undefined ? {} : { recipient: chosen },
    refused: undefined,
    clear: () => undefined,
    refuse: () => undefined,
    ...overrides,
  };
}

function weightOf(chosen?: string, levels: ComposerWeight["levels"] = LEVELS): ComposerWeight {
  return {
    levels,
    chosen,
    request: chosen === undefined ? {} : { weight: chosen },
    choose: () => undefined,
  };
}

describe("the line", () => {
  it("says who answers, with no weight clause when nothing is chosen", () => {
    const address = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: true,
    });
    expect(address.line).toBe(`${ORCHESTRATOR_LABEL} will answer`);
  });

  it("names the chosen level by its label, after who answers", () => {
    const address = composerAddress({
      weight: weightOf("heavy"),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: true,
    });
    expect(address.line).toBe(`${ORCHESTRATOR_LABEL} will answer · Heavy or judgment-laden`);
  });

  it("names a resident's designation-time weight, not a picked one", () => {
    // A standing choice of `light` exists — and the line still says the
    // resident's own weight, because that is what will run.
    const address = composerAddress({
      weight: weightOf("light"),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a"),
      live: true,
    });
    expect(address.line).toBe("Ana will answer · Heavy or judgment-laden");
  });

  it("says a launch-chosen weight as what it is, never as a level", () => {
    const address = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR, residentLane({ weight: null })], "th_a"),
      live: true,
    });
    expect(address.line).toBe(`Ana will answer · ${LAUNCH_WEIGHT_CLAUSE}`);
  });

  it("claims nothing about the weight of a lane the roster has not listed", () => {
    const address = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR], "th_new"),
      live: true,
    });
    expect(address.answering).toEqual(unknownLaneRow("th_new"));
    expect(address.line).toBe(`${unknownLaneRow("th_new").name} will answer`);
  });

  it("says the floor, and still says a pick standing on it", () => {
    const floor = composerAddress({
      weight: weightOf("heavy"),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a"),
      live: false,
    });
    expect(floor.line).toBe(NOBODY_ASKED);

    const picked = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a", { chosen: "th_a" }),
      live: false,
    });
    expect(picked.line).toBe(`${NOBODY_ASKED} — ${ADDRESSED_TO} Ana`);
  });

  it("claims no lane while the walk has not answered", () => {
    const address = composerAddress({
      weight: weightOf(),
      recipient: recipientOf(undefined, undefined),
      live: true,
    });
    expect(address.line).toBe(RECIPIENT_UNKNOWN_STATEMENT);
    expect(address.answering).toBeUndefined();
  });

  it("says a refusal loudly, and drops the weight clause under it", () => {
    const address = composerAddress({
      weight: weightOf("heavy"),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a", {
        chosen: "th_a",
        refused: "th_a",
      }),
      live: true,
    });
    expect(address.line).toBe(`Ana ${RECIPIENT_REFUSED_STATEMENT}`);
  });

  it("carries §7's missing-profile mark at rest", () => {
    const gone = residentLane({ docId: null });
    const address = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR, gone], "th_a"),
      live: true,
    });
    expect(address.line).toContain(MISSING_PROFILE_MARK);
  });
});

describe("what rides the request", () => {
  it("carries the chosen level for the orchestrator", () => {
    const address = composerAddress({
      weight: weightOf("heavy"),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: true,
    });
    expect(address.request).toEqual({ weight: "heavy" });
    expect(address.weightRequest).toEqual({ weight: "heavy" });
  });

  /**
   * The rider signed 2026-08-19, on the wire: a standing choice is **not sent**
   * when the recipient is a resident's lane. It is not silently discarded — it
   * is not made, because no control offered it for this recipient.
   */
  it("withholds a standing choice when a resident's lane answers", () => {
    const address = composerAddress({
      weight: weightOf("light"),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a", {
        chosen: "th_a",
        request: { recipient: "th_a" },
      }),
      live: true,
    });
    expect(address.weight.kind).toBe("resident");
    expect(address.request).toEqual({ recipient: "th_a" });
    expect("weight" in address.request).toBe(false);
  });

  it("withholds it on a lane the roster has not listed, for the same reason", () => {
    const address = composerAddress({
      weight: weightOf("light"),
      recipient: recipientOf([ORCHESTRATOR], "th_new", {
        chosen: "th_new",
        request: { recipient: "th_new" },
      }),
      live: true,
    });
    expect(address.weight).toEqual({
      kind: "resident",
      name: unknownLaneRow("th_new").name,
      weight: { kind: "unheard" },
    });
    expect("weight" in address.request).toBe(false);
  });

  it("states nothing on the floor — a value the surface no longer shows must not act", () => {
    const address = composerAddress({
      weight: weightOf("heavy"),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: false,
    });
    expect(address.weight.kind).toBe("unweighed");
    expect(address.request).toEqual({});
  });

  it("still carries a picked recipient on the floor", () => {
    const address = composerAddress({
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a", {
        chosen: "th_a",
        request: { recipient: "th_a" },
      }),
      live: false,
    });
    expect(address.request).toEqual({ recipient: "th_a" });
  });
});

describe("what the popover offers", () => {
  it("offers the levels for the orchestrator, and the standing undeclared choice", () => {
    const address = composerAddress({
      weight: weightOf("bespoke"),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: true,
    });
    if (address.weight.kind !== "choice") throw new Error("expected a choice");
    expect(address.weight.options.map((level) => level.key)).toEqual([
      "light",
      "standard",
      "heavy",
      "bespoke",
    ]);
  });

  it("offers nothing to weigh when the workspace declares no levels", () => {
    const address = composerAddress({
      weight: weightOf(undefined, []),
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: true,
    });
    expect(address.weight.kind).toBe("unweighed");
    expect(address.offers).toBe(false);
  });

  it("opens exactly when there is a lane to choose or a level to state", () => {
    const both = composerAddress({
      weight: weightOf(),
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a"),
      live: true,
    });
    expect(both.offers).toBe(true);

    const floorWithLanes = composerAddress({
      recipient: recipientOf([ORCHESTRATOR, residentLane()], "th_a"),
      live: false,
    });
    expect(floorWithLanes.offers).toBe(true);

    const nothing = composerAddress({
      recipient: recipientOf([ORCHESTRATOR], "orchestrator"),
      live: false,
    });
    expect(nothing.offers).toBe(false);
  });
});

describe("the resident sentence", () => {
  it("names the weight, and what a weight set here would have governed", () => {
    expect(residentWeightSentence("Ana", { kind: "set", key: "heavy", label: "Heavy" })).toBe(
      "Ana works at Heavy — a weight set here would govern only what Ana hands off",
    );
  });

  it("says the launcher chose when the designation named no level", () => {
    expect(residentWeightSentence("Ana", { kind: "launch" })).toBe(
      "Ana works at the weight chosen at launch — a weight set here would govern only what Ana hands off",
    );
  });

  it("claims nothing for a lane the roster has not described", () => {
    expect(residentWeightSentence("this conversation", { kind: "unheard" })).toContain(
      "set when it was designated",
    );
  });
});

describe("weightLabel", () => {
  it("maps a key through the guidance, and shows the key itself when it is gone", () => {
    expect(weightLabel(LEVELS, "standard")).toBe("Standard");
    expect(weightLabel(LEVELS, "bespoke")).toBe("bespoke");
    expect(weightLabel([], "heavy")).toBe("heavy");
  });
});
