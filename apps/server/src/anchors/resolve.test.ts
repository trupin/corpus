import { describe, expect, it } from "vitest";
import { resolveAnchor, resolveAnchors, sortedEntries } from "./resolve.js";

describe("resolveAnchor — rung 1: contextual exact", () => {
  // "the rate" occurs three times; only the context disambiguates.
  const body =
    "The plan floats the rate for a while. We fix the rate today at signing. Later the rate may drift again.";

  it("returns the occurrence surrounded by the declared context, not the first bare occurrence", () => {
    const range = resolveAnchor(body, {
      exact: "the rate",
      prefix: "We fix ",
      suffix: " today",
    });
    expect(range).not.toBeNull();
    expect(body.slice(range?.start, range?.end)).toBe("the rate");
    expect(range?.start).toBe(body.indexOf("We fix the rate") + "We fix ".length);
    expect(range?.start).not.toBe(body.indexOf("the rate"));
  });

  it("takes the first occurrence when even the contextual needle repeats", () => {
    const repeated = "x A B C y ... x A B C y";
    const range = resolveAnchor(repeated, { exact: "B", prefix: "A ", suffix: " C" });
    expect(range?.start).toBe(repeated.indexOf("B"));
  });

  it("resolves with one-sided context (anchor at body start)", () => {
    const range = resolveAnchor("needle then the rest", { exact: "needle", suffix: " then" });
    expect(range).toEqual({ start: 0, end: 6 });
  });
});

describe("resolveAnchor — rung 2: bare unique exact", () => {
  it("resolves a context-free selector whose exact occurs exactly once", () => {
    const body = "Some prose with a unique anchored fragment inside it.";
    const range = resolveAnchor(body, { exact: "unique anchored fragment" });
    expect(body.slice(range?.start, range?.end)).toBe("unique anchored fragment");
  });

  it("is reached only when rung 1 fails: stale context falls back to unique exact", () => {
    const body = "Rewritten intro. The unique anchored fragment survives. Rewritten outro.";
    const range = resolveAnchor(body, {
      exact: "unique anchored fragment",
      prefix: "context that no longer exists ",
      suffix: " nor does this",
    });
    expect(body.slice(range?.start, range?.end)).toBe("unique anchored fragment");
  });

  it("does not guess between duplicate occurrences (falls through to fuzzy tie-breaks)", () => {
    const body = "A same words B ... C same words D";
    // Context agreement with the second occurrence's real surroundings must win.
    const range = resolveAnchor(body, { exact: "same words", prefix: "C ", suffix: " D" });
    expect(range?.start).toBe(body.lastIndexOf("same words"));
  });

  it("counts overlapping occurrences as ambiguous", () => {
    // "aa" occurs twice in "aaa" (overlapping) — not unique, and fuzzy's
    // deterministic tie-breaks pick the earliest offset.
    const range = resolveAnchor("aaa", { exact: "aa" });
    expect(range?.start).toBe(0);
  });
});

describe("resolveAnchor — rung 3 and rung 4", () => {
  it("fuzzy-resolves a lightly edited body when exact no longer occurs", () => {
    const body = "Intro. Here the modle we assume a 30-year fixed at 6.1% holds. Outro.";
    const range = resolveAnchor(body, {
      exact: "the model we assume a 30-year fixed at 6.1%",
    });
    expect(range).not.toBeNull();
    expect(body.slice(range?.start, range?.end)).toContain("modle we assume");
  });

  it("uses the hint to disambiguate repeated identical text with no context", () => {
    const body = "P duplicated words Q ... R duplicated words S";
    const second = body.lastIndexOf("duplicated words");
    expect(resolveAnchor(body, { exact: "duplicated words" }, { hint: second })?.start).toBe(
      second,
    );
    expect(resolveAnchor(body, { exact: "duplicated words" }, { hint: 0 })?.start).toBe(
      body.indexOf("duplicated words"),
    );
  });

  it("clamps an out-of-range hint instead of throwing", () => {
    const body = "one two three";
    expect(resolveAnchor(body, { exact: "two" }, { hint: -50 })).not.toBeNull();
    expect(resolveAnchor(body, { exact: "two" }, { hint: 10_000 })).not.toBeNull();
  });

  it("returns null (orphaned) for an unrelated body rather than guessing", () => {
    const body = "Recipe: whisk three eggs, add flour and a pinch of salt.";
    expect(
      resolveAnchor(body, {
        exact: "the model we assume a 30-year fixed at 6.1%",
        prefix: "baseline ",
        suffix: " going forward",
      }),
    ).toBeNull();
  });

  it("returns null for an empty body or an empty exact", () => {
    expect(resolveAnchor("", { exact: "needle" })).toBeNull();
    expect(resolveAnchor("body", { exact: "" })).toBeNull();
  });
});

describe("resolveAnchor — unicode", () => {
  it("returns code-point-aligned ranges around astral, combining, and RTL text", () => {
    const body = "עברית before 🎉 the anchored ✍️ text 🚀 after café́ done";
    const exact = "the anchored ✍️ text";
    const range = resolveAnchor(body, { exact });
    expect(range).not.toBeNull();
    expect(body.slice(range?.start, range?.end)).toBe(exact);
  });
});

describe("resolveAnchors", () => {
  it("resolves a whole map in one pass, null for orphans, sorted deterministic keys", () => {
    const body = "First sentence here. Second sentence there.";
    const resolved = resolveAnchors(body, {
      anc_bb: { exact: "Second sentence" },
      anc_aa: { exact: "First sentence" },
      anc_cc: { exact: "vanished text" },
    });
    expect(Object.keys(resolved)).toEqual(["anc_aa", "anc_bb", "anc_cc"]);
    expect(resolved["anc_aa"]).toEqual({ start: 0, end: 14 });
    expect(body.slice(resolved["anc_bb"]?.start, resolved["anc_bb"]?.end)).toBe("Second sentence");
    expect(resolved["anc_cc"]).toBeNull();
  });

  it("returns an empty map for a document with no anchors", () => {
    expect(resolveAnchors("any body", {})).toEqual({});
  });
});

describe("sortedEntries", () => {
  it("sorts by plain code-unit order regardless of insertion order", () => {
    const entries = sortedEntries({
      anc_z: { exact: "z" },
      anc_A: { exact: "A" },
      anc_a: { exact: "a" },
    });
    expect(entries.map(([id]) => id)).toEqual(["anc_A", "anc_a", "anc_z"]);
  });
});
