import { describe, expect, it } from "vitest";
import { computeContext } from "./context.js";
import { resolveAnchor, resolveAnchorExact, resolveAnchors, sortedEntries } from "./resolve.js";
import type { TextQuoteSelectorInput } from "./types.js";

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

describe("resolveAnchorExact — the exactness tier stops before fuzzy", () => {
  it("resolves via rung 1 (contextual exact)", () => {
    const body = "The plan floats the rate. We fix the rate today. Later the rate drifts.";
    const range = resolveAnchorExact(body, {
      exact: "the rate",
      prefix: "We fix ",
      suffix: " today",
    });
    expect(range?.start).toBe(body.indexOf("We fix the rate") + "We fix ".length);
  });

  it("resolves via rung 2 (bare unique exact) when the context is stale", () => {
    const body = "Rewritten intro. The unique anchored fragment survives. Rewritten outro.";
    const range = resolveAnchorExact(body, {
      exact: "unique anchored fragment",
      prefix: "gone ",
      suffix: " also gone",
    });
    expect(body.slice(range?.start, range?.end)).toBe("unique anchored fragment");
  });

  it("returns null where resolveAnchor would fall through to fuzzy", () => {
    // A one-character corruption: similar, but not verbatim.
    const body = "Intro. Here the modle we assume a 30-year fixed at 6.1% holds. Outro.";
    const selector = { exact: "the model we assume a 30-year fixed at 6.1%" };
    expect(resolveAnchorExact(body, selector)).toBeNull();
    expect(resolveAnchor(body, selector)).not.toBeNull();
  });

  it("returns null for a non-unique exact with stale context — never guesses between duplicates", () => {
    const body = "A same words B ... C same words D";
    expect(
      resolveAnchorExact(body, { exact: "same words", prefix: "X ", suffix: " Y" }),
    ).toBeNull();
    expect(resolveAnchorExact(body, { exact: "same words" })).toBeNull();
  });

  it("returns null for an empty body or an empty exact", () => {
    expect(resolveAnchorExact("", { exact: "needle" })).toBeNull();
    expect(resolveAnchorExact("body", { exact: "" })).toBeNull();
  });
});

/**
 * Why rung 3 is reconciliation's alone, in the shapes that decide it.
 *
 * Every case here builds its selector the way a real comment does — the quoted
 * range plus `computeContext`'s real `prefix`/`suffix` — edits the body, and
 * asks both resolvers. The assertions are deliberately two-sided: the reader's
 * `resolveAnchorExact` must orphan, and the full ladder must be shown *landing
 * somewhere it should not*, because that is the fact the policy rests on. If a
 * future change makes rung 3 safe on these shapes, these tests fail loudly and
 * ask to be revisited rather than quietly permitting a rewiring.
 *
 * Every list here has three or more parallel items on purpose. At two items a
 * deletion shortens the body by a whole item, and the length term of any
 * context comparison rejects the sibling for free — which is exactly how a
 * two-item fixture can make an unsafe gate look safe (the SERVER-055 revert's
 * finding).
 */
describe("rung 3 is inadmissible on a read path", () => {
  const selectorFor = (body: string, exact: string): TextQuoteSelectorInput => {
    const start = body.indexOf(exact);
    expect(start).toBeGreaterThanOrEqual(0);
    return { exact, ...computeContext(body, start, start + exact.length) };
  };

  const GROCERIES =
    "# Shopping\n\n- eggs from the corner bakery\n- bread from the corner bakery\n- milk from the corner bakery\n- jam from the corner bakery\n";
  const QUARTERS =
    "# Weekly\n\n- Review the Q1 report by Friday\n- Review the Q2 report by Friday\n- Review the Q3 report by Friday\n- Review the Q4 report by Friday\n";
  const TABLE =
    "| region | owner | status |\n| --- | --- | --- |\n| north-1 | alice | green |\n| north-2 | alice | green |\n| north-3 | alice | green |\n| north-4 | alice | green |\n";
  const TASKS =
    "# Sprint\n\n- [ ] write the quarterly report draft\n- [ ] write the quarterly report notes\n- [ ] write the quarterly report deck\n- [ ] write the quarterly report memo\n";
  const PROSE =
    "# Notes\n\nAttendees agreed to revisit the pricing model in Q1.\n\nAttendees agreed to revisit the staffing model in Q2.\n\nAttendees agreed to revisit the roadmap model in Q3.\n";
  const STEPS =
    "1. first configure the gateway service\n2. next configure the gateway service\n3. then configure the gateway service\n4. last configure the gateway service\n";

  it.each([
    ["homogeneous bullets", GROCERIES, "- bread from the corner bakery"],
    ["a one-character-apart list, middle item", QUARTERS, "- Review the Q2 report by Friday"],
    ["a one-character-apart list, first item", QUARTERS, "- Review the Q1 report by Friday"],
    ["a one-character-apart list, last item", QUARTERS, "- Review the Q4 report by Friday"],
    ["parallel table rows", TABLE, "| north-2 | alice | green |"],
    ["a task list", TASKS, "- [ ] write the quarterly report notes"],
    ["parallel prose paragraphs", PROSE, "Attendees agreed to revisit the pricing model in Q1."],
    ["numbered steps", STEPS, "2. next configure the gateway service"],
  ])(
    "orphans a deleted item of %s, which the fuzzy rung hands a sibling",
    (_shape, body, exact) => {
      const selector = selectorFor(body, exact);
      const edited = body.replace(`${exact}\n`, "");

      // The quoted text is gone from the page, verbatim and entirely.
      expect(edited).not.toContain(exact);
      // The reader's answer: gone is gone.
      expect(resolveAnchorExact(edited, selector)).toBeNull();

      // The full ladder's answer, and the reason it stays off this path: a range,
      // over text the anchor's author never commented on.
      const guessed = resolveAnchor(edited, selector);
      expect(guessed).not.toBeNull();
      expect(edited.slice(guessed?.start, guessed?.end)).not.toBe(exact);
    },
  );

  it("orphans an *edited* row rather than pointing at the row below it", () => {
    // The failure that is worse than detaching: the anchored row is still on the
    // page, edited in place, and rung 3 answers with its untouched neighbour.
    const selector = selectorFor(TABLE, "| north-2 | alice | green |");
    const edited = TABLE.replace("| north-2 | alice | green |", "| north-2 | alice | amber |");

    // `amber` occurs only on the anchored row, so "the answer does not contain
    // it" is exactly "the answer is some other row".
    const guessed = resolveAnchor(edited, selector);
    expect(guessed).not.toBeNull();
    expect(edited.slice(guessed?.start, guessed?.end)).not.toContain("amber");
    expect(resolveAnchorExact(edited, selector)).toBeNull();
  });

  it("orphans an edited list item rather than pointing at the item below it", () => {
    const selector = selectorFor(QUARTERS, "- Review the Q2 report by Friday");
    const edited = QUARTERS.replace(
      "- Review the Q2 report by Friday",
      "- Review the Q2 revenue report by Friday",
    );

    // `revenue` occurs only on the anchored item.
    const guessed = resolveAnchor(edited, selector);
    expect(guessed).not.toBeNull();
    expect(edited.slice(guessed?.start, guessed?.end)).not.toContain("revenue");
    expect(resolveAnchorExact(edited, selector)).toBeNull();
  });

  it("has no answer to find: two intents share one before-and-after pair", () => {
    // Deleting the Q2 line, and renaming it to Q3 while deleting the old Q3
    // line, produce the same `newBody` from the same `oldBody` with the same
    // selector — and want opposite outcomes. Nothing computed from these bodies
    // can be right about both, so §6 breaks the tie one way: orphan.
    const selector = selectorFor(QUARTERS, "- Review the Q2 report by Friday");
    const deleted = QUARTERS.replace("- Review the Q2 report by Friday\n", "");
    const renamed = QUARTERS.replace(
      "- Review the Q2 report by Friday\n- Review the Q3 report by Friday\n",
      "- Review the Q3 report by Friday\n",
    );
    expect(renamed).toBe(deleted);
    expect(resolveAnchorExact(deleted, selector)).toBeNull();
  });

  it("still resolves a genuinely unique edited passage — the cost of the policy", () => {
    // Not a lookalike in sight: rung 3 gets this right, and the reader gives it
    // up anyway, because the reader cannot tell this body from the ones above.
    // Reconciliation, which holds the diff, repairs the selector on the next
    // save (`docs/read.test.ts` round-trips it).
    const body = "# Mortgage\n\nWe assume a 30-year fixed at 6.4% and no refinancing.\n";
    const selector = { exact: "assume a 30-year fixed at 6.1%", prefix: "We ", suffix: " and no" };
    expect(resolveAnchor(body, selector)).not.toBeNull();
    expect(resolveAnchorExact(body, selector)).toBeNull();
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
