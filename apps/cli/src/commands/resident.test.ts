import { ResidentSchema } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { GENERAL_RESIDENT, PROFILE_MISSING, residentLabel } from "./resident.js";

/**
 * One label for four surfaces (`thread designate`, `thread release`,
 * `thread show`, `agents`), so the test that matters is that it keeps the
 * contract's three states three (SPEC.md §7, rider SHARED-048).
 */

const GENERAL = { name: null, docId: null };
const PROFILED = { name: "researcher", docId: "doc_r1" };
const ORPHANED = { name: "researcher", docId: null };

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
    expect(ResidentSchema.safeParse({ name: null, docId: "doc_r1" }).success).toBe(false);
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
