import { SEMANTIC_INDEX_STATES } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { semanticIndexNote } from "./retrieval.js";

/**
 * Phase A never prints this line — the field is absent or `current` and nothing
 * computes it — so the gating is what has to be tested, not the wording. The
 * cases below stand in for the server states a Phase B build will produce,
 * including one nobody has defined yet.
 */

describe("semanticIndexNote", () => {
  it("says nothing when the server makes no claim — Phase A's normal answer", () => {
    expect(semanticIndexNote(undefined)).toBeUndefined();
  });

  it("says nothing when the index is current", () => {
    expect(semanticIndexNote("current")).toBeUndefined();
  });

  it.each(SEMANTIC_INDEX_STATES.filter((state) => state !== "current"))(
    "reports degraded ranking when the index is %s",
    (state) => {
      const note = semanticIndexNote(state);
      expect(note).toContain("degraded");
      expect(note).toContain(state);
    },
  );

  it("treats a state it has never heard of as degraded rather than as current", () => {
    // The contract's published rule is `!== "current"`, precisely so a Phase B
    // value can arrive without a client upgrade.
    expect(semanticIndexNote("reticulating")).toContain("reticulating");
  });

  it("is one line, and marked so it cannot be mistaken for a result", () => {
    const note = semanticIndexNote("indexing") ?? "";
    expect(note.startsWith("# ")).toBe(true);
    expect(note).not.toContain("\n");
  });
});
