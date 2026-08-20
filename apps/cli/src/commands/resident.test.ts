import { ResidentSchema } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { agentsCommand } from "./agents.js";
import {
  AT_WEIGHT,
  GENERAL_RESIDENT,
  PROFILE_MISSING,
  residentLabel,
  withWeight,
} from "./resident.js";
import { designateCommand } from "./thread/designate.js";
import { showCommand } from "./thread/show.js";

/**
 * One label for four surfaces (`thread designate`, `thread release`,
 * `thread show`, `agents`), so the test that matters is that it keeps the
 * contract's three states three (SPEC.md §7, rider SHARED-048).
 */

const GENERAL = { name: null, docId: null, weight: null };
const PROFILED = { name: "researcher", docId: "doc_r1", weight: null };
const ORPHANED = { name: "researcher", docId: null, weight: null };

describe("residentLabel", () => {
  it("renders each of the three states the contract publishes", () => {
    expect(residentLabel(GENERAL)).toBe("a general resident");
    expect(residentLabel(PROFILED)).toBe("researcher (doc_r1)");
    expect(residentLabel(ORPHANED)).toBe("researcher (profile missing)");
  });

  it("renders no two of them the same, which is the whole requirement", () => {
    const labels = [GENERAL, PROFILED, ORPHANED].map(residentLabel);
    expect(new Set(labels).size).toBe(3);
  });

  it("is rendering states the contract actually admits, not shapes invented here", () => {
    // The fixtures above are the three combinations `ResidentSchema` accepts;
    // the fourth is refined away there, so nothing renders it.
    for (const resident of [GENERAL, PROFILED, ORPHANED]) {
      expect(ResidentSchema.safeParse(resident).success).toBe(true);
    }
    expect(ResidentSchema.safeParse({ name: null, docId: "doc_r1", weight: null }).success).toBe(
      false,
    );
  });

  it("never puts the general resident where a profile name goes", () => {
    // `schemas/agents.ts` is explicit: a word substituted for a null `name` and
    // printed as one would be indistinguishable from a real profile beside it,
    // and could collide with an agent-def titled the same. A profile is always
    // `name (something)`; a general resident has no parenthesis at all.
    expect(residentLabel(GENERAL)).not.toContain("(");
    expect(residentLabel(PROFILED)).toContain("(");
    expect(residentLabel(ORPHANED)).toContain("(");
  });

  it("never prints a null, whichever field is one", () => {
    for (const resident of [GENERAL, PROFILED, ORPHANED]) {
      expect(residentLabel(resident)).not.toContain("null");
      expect(residentLabel(resident)).not.toContain("undefined");
    }
  });

  it("exports the two words rather than spelling them at each use site", () => {
    expect(residentLabel(GENERAL)).toBe(GENERAL_RESIDENT);
    expect(residentLabel(ORPHANED)).toContain(PROFILE_MISSING);
  });
});

/**
 * **The weight (CLI-053, SPEC.md §7's rider signed 2026-08-19).** A fourth
 * field, not a fourth state: it is orthogonal to the profile pair, so what these
 * assert is that it prints as a suffix on all three labels, that a null prints
 * *nothing* — the same prohibition `name` carries — and that the join cannot be
 * read as part of a profile name.
 */
describe("the weight a resident runs at", () => {
  it("prints after every one of the three labels, and reads as English", () => {
    expect(residentLabel({ ...GENERAL, weight: "heavy" })).toBe("a general resident at heavy");
    expect(residentLabel({ ...PROFILED, weight: "heavy" })).toBe("researcher (doc_r1) at heavy");
    expect(residentLabel({ ...ORPHANED, weight: "heavy" })).toBe(
      "researcher (profile missing) at heavy",
    );
  });

  it("invents no token for a weight nobody chose", () => {
    // The acceptance criterion, and the same rule `Resident.name` carries: a
    // word standing in for an unstated level would read beside real level keys
    // as one of them.
    for (const resident of [GENERAL, PROFILED, ORPHANED]) {
      const label = residentLabel(resident);
      expect(label).not.toContain(` ${AT_WEIGHT} `);
      expect(label).not.toContain("null");
      expect(label).not.toContain("none");
      expect(label).not.toContain("default");
    }
    // And a stated weight is the only difference: nothing else about the label
    // changes, so the two are the same line plus a suffix.
    expect(residentLabel({ ...PROFILED, weight: "light" })).toBe(
      `${residentLabel(PROFILED)} at light`,
    );
  });

  it("takes the workspace's own vocabulary verbatim, whatever it is", () => {
    // §7 keeps the tier table in the orchestrate skill, so this CLI publishes no
    // levels and must render a key it has never seen exactly as it arrived.
    expect(residentLabel({ ...PROFILED, weight: "deliberate" })).toBe(
      "researcher (doc_r1) at deliberate",
    );
    expect(residentLabel({ ...GENERAL, weight: "tier-2" })).toBe("a general resident at tier-2");
  });

  it("keeps the join outside the parenthesis a profile name lives in", () => {
    // A weight must never be readable as part of the profile's document id.
    const label = residentLabel({ ...PROFILED, weight: "heavy" });
    expect(label.indexOf(")")).toBeLessThan(label.indexOf(AT_WEIGHT));
    expect(label).toContain("(doc_r1)");
  });

  it("prints nothing rather than a bare `at` for a blank the contract would refuse", () => {
    // `RequestedWeightSchema` is non-blank, so a conforming server cannot send
    // one — and a trailing `at` with nothing after it is a worse thing to show
    // than an absence.
    expect(ResidentSchema.safeParse({ ...PROFILED, weight: "" }).success).toBe(false);
    expect(residentLabel({ ...PROFILED, weight: "" })).toBe("researcher (doc_r1)");
    expect(residentLabel({ ...PROFILED, weight: "   " })).toBe("researcher (doc_r1)");
  });

  it("adds the weight to a label built without a Resident, for designate's fallback", () => {
    expect(withWeight(GENERAL_RESIDENT, "heavy")).toBe("a general resident at heavy");
    expect(withWeight("researcher", null)).toBe("researcher");
  });
});

/**
 * **What makes a profile go missing — one list, pinned to the contract's.**
 *
 * Three CLI surfaces tell a reader when `name (profile missing)` is what they
 * will see, and every one of them used to say *archived*, which is false:
 * `targetRows` filters on no status, and archiving an `agent-def` does not move
 * its file, so an archived persona under `.claude/agents/` resolves exactly as
 * it did and is still designatable. The claim survived a sweep because each
 * surface spelled it differently, so what is pinned here is the **literal** —
 * the same substring at all three, and the same one the contract's `docId`
 * carries — rather than three restatements a future edit can drift apart one at
 * a time.
 *
 * The archive clause is stated **positively** for the same reason: a reader who
 * archives a profile and then wonders comes looking for the word, and prose that
 * merely omits it answers nobody.
 */
const WAYS_A_PROFILE_GOES_MISSING = "renamed, deleted, or moved out of `.claude/agents/`";
const ARCHIVING_IS_NOT_ONE =
  "an archived `agent-def` still under that root resolves exactly as before, and is still " +
  "designatable";

describe("what the CLI says makes a profile go missing", () => {
  // `description` is optional on a command spec, so a surface that lost its
  // prose entirely arrives here as `undefined` and fails the pin rather than
  // passing it vacuously.
  const surfaces: ReadonlyArray<readonly [string, string | undefined]> = [
    ["thread designate", designateCommand.description],
    ["thread show", showCommand.description],
    ["agents", agentsCommand.description],
  ];

  it("is the contract's own list, at the surface that reports the miss", () => {
    expect(ResidentSchema.shape.docId.description).toContain(WAYS_A_PROFILE_GOES_MISSING);
    for (const [surface, prose] of surfaces) {
      expect(prose, surface).toContain(WAYS_A_PROFILE_GOES_MISSING);
    }
  });

  it("says archiving is not one of them, rather than leaving it out", () => {
    expect(ResidentSchema.shape.docId.description).toContain(ARCHIVING_IS_NOT_ONE);
    for (const [surface, prose] of surfaces) {
      expect(prose, surface).toContain(ARCHIVING_IS_NOT_ONE);
      // The false claim, in the spelling every one of these three had it in.
      expect(prose, surface).not.toContain("renamed or archived");
    }
  });
});
