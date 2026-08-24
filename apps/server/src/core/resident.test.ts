import { describe, expect, it } from "vitest";
import { AGENT_NAME_MAX_LENGTH, REQUESTED_WEIGHT_MAX_LENGTH } from "@corpus/contract";
import { residentOrNull, residentProblem, residentToStored, storedResident } from "./resident.js";

describe("residentOrNull", () => {
  it("reads a well-formed designation", () => {
    expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3" })).toEqual({
      name: "researcher",
      docId: "doc_a1b2c3",
      weight: null,
      // A designation written before CONTRACT-071 has no `designationId` key,
      // which the wire reports as null — the pre-CONTRACT-071 behaviour, safely
      // (SERVER-147).
      designationId: null,
    });
  });

  it.each([
    ["nothing at all", undefined],
    ["an explicit null", null],
    ["a bare name", "researcher"],
    ["a name with no document", { name: "researcher" }],
    ["a document with no name", { docId: "doc_a1b2c3" }],
    ["a blank name", { name: "   ", docId: "doc_a1b2c3" }],
    ["a name spanning lines", { name: "resea\nrcher", docId: "doc_a1b2c3" }],
    ["a thread id in place of a document", { name: "researcher", docId: "th_a1b2c3" }],
    ["a name past the bound", { name: "a".repeat(AGENT_NAME_MAX_LENGTH + 1), docId: "doc_a1b2c3" }],
  ])("reads %s as no resident", (_label, value) => {
    expect(residentOrNull(value)).toBeNull();
  });

  it("keeps only the fields the wire carries", () => {
    expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3", live: true })).toEqual({
      name: "researcher",
      docId: "doc_a1b2c3",
      weight: null,
      designationId: null,
    });
  });

  it("reads both halves null as a general resident, not as no resident", () => {
    expect(residentOrNull({ name: null, docId: null })).toEqual({
      name: null,
      docId: null,
      weight: null,
      designationId: null,
    });
  });

  it("reads a document id with no name as no resident", () => {
    expect(residentOrNull({ name: null, docId: "doc_a1b2c3" })).toBeNull();
  });

  it("reads a name with a null document as a designation whose profile is missing", () => {
    expect(residentOrNull({ name: "researcher", docId: null })).toEqual({
      name: "researcher",
      docId: null,
      weight: null,
      designationId: null,
    });
  });

  /**
   * SPEC.md §7's rider signed 2026-08-19 (SERVER-129). The stored shape and the
   * wire shape differ by exactly one rule: on disk, absence is how "no level was
   * chosen" is spelled, and on the wire it is `null`.
   */
  describe("the weight", () => {
    it("reads a stated level verbatim", () => {
      expect(residentOrNull({ name: null, docId: null, weight: "heavy" })).toEqual({
        name: null,
        docId: null,
        weight: "heavy",
        designationId: null,
      });
    });

    // The tolerance every designation written before the rider depends on: no
    // `weight` key at all is a designation with no level, never no designation.
    it("reads an absent key as no level chosen", () => {
      expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3" })?.weight).toBeNull();
    });

    // What YAML's `weight:` with no value parses to. One meaning, two spellings
    // on disk, and only one of them is ever written by this server.
    it("reads an explicit null the same way", () => {
      expect(
        residentOrNull({ name: "researcher", docId: "doc_a1b2c3", weight: null })?.weight,
      ).toBeNull();
    });

    // Orthogonal to the profile pair: a general resident may run at a level.
    it("reads a general resident's level", () => {
      expect(residentOrNull({ name: null, docId: null, weight: "light" })?.weight).toBe("light");
    });

    // The value is opaque here. The tier table is the workspace's own skill
    // text, which this server never reads, so nothing can be checked against it.
    it("reads a level nothing in this server recognises", () => {
      expect(residentOrNull({ name: null, docId: null, weight: "featherweight" })?.weight).toBe(
        "featherweight",
      );
    });

    // The block is one value. Dropping only the weight would substitute "none
    // chosen" for a choice somebody made, which §7's rider forbids.
    it.each([
      ["a number", 3],
      ["a blank string", "   "],
      ["an empty string", ""],
      ["two lines", "hea\nvy"],
      ["a level past the bound", "x".repeat(REQUESTED_WEIGHT_MAX_LENGTH + 1)],
    ])("reads a designation whose weight is %s as no resident", (_label, weight) => {
      expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3", weight })).toBeNull();
    });
  });
});

/**
 * The inverse of {@link residentOrNull}: what a designation puts on disk.
 *
 * Its whole job is that "no level chosen" has one spelling in a file — the
 * absent key — so a reader never meets two nothings (SERVER-129).
 */
describe("residentToStored", () => {
  it("writes no `weight` key when no level was chosen", () => {
    const stored = residentToStored({
      name: "researcher",
      docId: "doc_a1b2c3",
      weight: null,
      designationId: null,
    });
    expect(stored).toEqual({ name: "researcher", docId: "doc_a1b2c3" });
    expect(Object.hasOwn(stored, "weight")).toBe(false);
  });

  it("writes the level beside the profile when one was chosen", () => {
    expect(
      residentToStored({
        name: "researcher",
        docId: "doc_a1b2c3",
        weight: "heavy",
        designationId: null,
      }),
    ).toEqual({
      name: "researcher",
      docId: "doc_a1b2c3",
      weight: "heavy",
    });
  });

  it("round-trips through the reader, both ways", () => {
    for (const weight of [null, "heavy"]) {
      for (const designationId of [null, "des_abcdefgh2345"]) {
        const resident = { name: null, docId: null, weight, designationId };
        expect(residentOrNull(residentToStored(resident))).toEqual(resident);
      }
    }
  });

  /**
   * SERVER-147. Same rule as `weight`, same reason: a file has one spelling of
   * "there is no id here", and it is the absent key — which is how every
   * designation written before CONTRACT-071 spells it.
   */
  it("writes no `designationId` key when there is none", () => {
    const stored = residentToStored({
      name: null,
      docId: null,
      weight: null,
      designationId: null,
    });
    expect(Object.hasOwn(stored, "designationId")).toBe(false);
  });

  it("writes the id when there is one", () => {
    expect(
      residentToStored({
        name: null,
        docId: null,
        weight: null,
        designationId: "des_abcdefgh2345",
      }),
    ).toEqual({ name: null, docId: null, designationId: "des_abcdefgh2345" });
  });
});

describe("storedResident", () => {
  const resident = { name: "researcher", docId: "doc_a1b2c3", weight: null, designationId: null };

  it("reads a standalone thread's designation", () => {
    expect(storedResident(resident, null)).toEqual(resident);
  });

  it("reads nothing off a thread that has a parent", () => {
    expect(storedResident(resident, "doc_parent1")).toBeNull();
  });

  it("reads a general designation off a standalone thread, and none off a parented one", () => {
    const general = { name: null, docId: null, weight: null, designationId: null };
    expect(storedResident(general, null)).toEqual(general);
    expect(storedResident(general, "doc_parent1")).toBeNull();
  });
});

describe("residentProblem (SERVER-132)", () => {
  it.each([
    ["nothing at all", undefined],
    ["an explicit null", null],
  ])("says nothing about %s, which is what nearly every thread carries", (_label, value) => {
    expect(residentProblem(value)).toBeNull();
  });

  it("says nothing about a block that reads as a designation", () => {
    expect(residentProblem({ name: "researcher", docId: "doc_a1b2c3" })).toBeNull();
    expect(residentProblem({ name: null, docId: null })).toBeNull();
  });

  it.each([
    ["a bare name", "researcher"],
    ["a list", [{ name: "researcher", docId: "doc_a1b2c3" }]],
  ])("reports %s as not a mapping", (_label, value) => {
    expect(residentProblem(value)).toBe("`resident` is not a mapping");
  });

  it("names the key at fault on the issue's own example, a numeric weight", () => {
    // The PR #52 reviewer's case: `weight: 3` from a hand edit fails the parse
    // and takes the whole block with it, so the thread reads as undesignated.
    const problem = residentProblem({ name: "researcher", docId: "doc_a1b2c3", weight: 3 });
    expect(problem).not.toBeNull();
    expect(problem).toContain("`weight`");
  });

  it("names a bad profile pair without restating what a designation may be", () => {
    const problem = residentProblem({ name: "researcher", docId: "th_a1b2c3" });
    expect(problem).not.toBeNull();
    expect(problem).toContain("`docId`");
  });

  it("agrees with the reader about which blocks are ill-shaped", () => {
    // The one invariant that must never drift: a block the reader refuses is
    // exactly a block this reports on, and vice versa. Both go through the same
    // two normalizations, which is what makes it true rather than watched.
    const cases: unknown[] = [
      undefined,
      null,
      "researcher",
      { name: "researcher", docId: "doc_a1b2c3" },
      { name: "researcher", docId: "doc_a1b2c3", weight: 3 },
      { name: null, docId: null },
      { name: "researcher" },
      { name: "   ", docId: "doc_a1b2c3" },
      { name: "a".repeat(AGENT_NAME_MAX_LENGTH + 1), docId: "doc_a1b2c3" },
      { name: "researcher", docId: "doc_a1b2c3", weight: "x".repeat(REQUESTED_WEIGHT_MAX_LENGTH) },
    ];
    for (const value of cases) {
      const absent = value === undefined || value === null;
      const reported = residentProblem(value) !== null;
      expect(reported, JSON.stringify(value) ?? "undefined").toBe(
        !absent && residentOrNull(value) === null,
      );
    }
  });
});
