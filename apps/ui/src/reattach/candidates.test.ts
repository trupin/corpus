import { describe, expect, it } from "vitest";
import {
  findReattachCandidates,
  MAX_CANDIDATES,
  MAX_QUOTE_LENGTH,
  maxEdits,
  SEARCH_CELL_BUDGET,
  type ReattachCandidate,
} from "./candidates";

const textsOf = (candidates: readonly ReattachCandidate[]): string[] =>
  candidates.map((candidate) => candidate.text);

/**
 * Every shape SERVER-055's revert names, at **three or more parallel items**.
 *
 * The previous attempt's safety tests passed on two-item fixtures, which was
 * shape-luck rather than safety: with two siblings a length term or a context
 * term is often enough to separate them, and with three or more it never is.
 * These fixtures are therefore the floor, not a sample — each one is a list
 * whose members differ by a token and agree on everything else.
 */
const SHAPES = {
  bullets: {
    body: [
      "# Actions",
      "",
      "- Review the Q1 report by Friday",
      "- Review the Q2 report by Friday",
      "- Review the Q3 report by Friday",
      "- Review the Q4 report by Friday",
      "",
    ].join("\n"),
    quote: "Review the Q2 report by Friday",
    siblings: 4,
  },
  table: {
    body: [
      "| region | owner | status |",
      "| --- | --- | --- |",
      "| north-1 | alice | green |",
      "| north-2 | alice | green |",
      "| north-3 | alice | green |",
      "| north-4 | alice | green |",
      "",
    ].join("\n"),
    quote: "| north-2 | alice | green |",
    siblings: 4,
  },
  tasks: {
    body: [
      "## Release",
      "",
      "- [ ] Ship the alpha build to staging",
      "- [ ] Ship the beta build to staging",
      "- [ ] Ship the gamma build to staging",
      "",
    ].join("\n"),
    quote: "Ship the beta build to staging",
    siblings: 3,
  },
  prose: {
    body: [
      "The northern team owns the intake queue and reports on Monday.",
      "The eastern team owns the intake queue and reports on Monday.",
      "The western team owns the intake queue and reports on Monday.",
      "",
    ].join("\n"),
    quote: "The eastern team owns the intake queue and reports on Monday.",
    siblings: 3,
  },
  numbered: {
    body: [
      "1. Draft the migration note and circulate it",
      "2. Draft the rollback note and circulate it",
      "3. Draft the rollout note and circulate it",
      "4. Draft the retiring note and circulate it",
      "",
    ].join("\n"),
    quote: "Draft the rollback note and circulate it",
    siblings: 4,
  },
} as const;

/** `body` with the line holding `quote` removed — the deletion these repairs follow. */
function withoutQuotedLine(body: string, quote: string): string {
  return body
    .split("\n")
    .filter((line) => !line.includes(quote))
    .join("\n");
}

describe("findReattachCandidates — the adversarial shapes", () => {
  it.each(Object.entries(SHAPES))(
    "%s: offers every surviving sibling after the quoted line is deleted",
    (_shape, { body, quote, siblings }) => {
      const after = withoutQuotedLine(body, quote);
      const { candidates, limit } = findReattachCandidates({ body: after, quote });

      expect(limit).toBeNull();
      expect(candidates.length).toBe(siblings - 1);
      for (const candidate of candidates) {
        expect(after.slice(candidate.range.start, candidate.range.end)).toBe(candidate.text);
      }
    },
  );

  it.each(Object.entries(SHAPES))(
    "%s: returns candidates in document order and never overlapping",
    (_shape, { body, quote }) => {
      const after = withoutQuotedLine(body, quote);
      const { candidates } = findReattachCandidates({ body: after, quote });

      const starts = candidates.map((candidate) => candidate.range.start);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i]?.range.start).toBeGreaterThanOrEqual(
          candidates[i - 1]?.range.end ?? 0,
        );
      }
    },
  );

  it.each(Object.entries(SHAPES))(
    "%s: shows the neighbouring lines, which is what tells the siblings apart",
    (_shape, { body, quote }) => {
      const after = withoutQuotedLine(body, quote);
      const { candidates } = findReattachCandidates({ body: after, quote });

      // Every candidate carries text on at least one side; a passage shown with
      // no surroundings is one a person cannot tell from its siblings.
      for (const candidate of candidates) {
        expect(candidate.before.length + candidate.after.length).toBeGreaterThan(0);
      }
    },
  );

  it("carries no score, and no candidate is marked as chosen", () => {
    const { body, quote } = SHAPES.bullets;
    const { candidates } = findReattachCandidates({ body: withoutQuotedLine(body, quote), quote });

    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "after",
        "before",
        "followedByMore",
        "precededByMore",
        "range",
        "takenBy",
        "text",
      ]);
    }
  });
});

describe("findReattachCandidates — SERVER-059's construction", () => {
  /**
   * The two histories that produce the same after-state from the same
   * before-state and demand opposite answers. Both readings must be *offered*,
   * and the module must not prefer either — that preference is the whole failure
   * SERVER-055 shipped.
   */
  const before = [
    "- Review the Q1 report by Friday",
    "- Review the Q2 report by Friday",
    "- Review the Q3 report by Friday",
    "- Review the Q4 report by Friday",
  ].join("\n");

  // (a) Q2 deleted. (b) Q2 renamed to Q3 and the old Q3 deleted. Same bytes.
  const after = [
    "- Review the Q1 report by Friday",
    "- Review the Q3 report by Friday",
    "- Review the Q4 report by Friday",
  ].join("\n");

  it("offers all three survivors, so both readings are reachable", () => {
    expect(before).not.toBe(after);
    const { candidates } = findReattachCandidates({
      body: after,
      quote: "Review the Q2 report by Friday",
    });

    expect(textsOf(candidates)).toEqual([
      "Review the Q1 report by Friday",
      "Review the Q3 report by Friday",
      "Review the Q4 report by Friday",
    ]);
  });
});

describe("findReattachCandidates — completeness", () => {
  /** Every substring within `k` edits of the quote, by exhaustive search. */
  function bruteForceMatches(body: string, quote: string): { start: number; end: number }[] {
    const k = maxEdits(quote);
    const hits: { start: number; end: number }[] = [];
    for (let start = 0; start < body.length; start++) {
      for (let end = start + 1; end <= body.length; end++) {
        if (levenshtein(body.slice(start, end), quote) <= k) hits.push({ start, end });
      }
    }
    return hits;
  }

  function levenshtein(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current.push(
          Math.min(
            (previous[j] ?? 0) + 1,
            (current[j - 1] ?? 0) + 1,
            (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
          ),
        );
      }
      previous = current;
    }
    return previous[b.length] ?? 0;
  }

  it.each([
    ["alpha beta gamma", "alpha beta gamma"],
    ["xx alpha beta yy alpha bota zz", "alpha beta"],
    ["- one\n- two\n- three\n- four", "- twoo"],
    ["aaaa bbbb cccc", "bbbb"],
    ["no resemblance whatsoever", "qqqqqqqqqq"],
  ])("covers every brute-forced match in %j for %j", (body, quote) => {
    const { candidates, limit } = findReattachCandidates({ body, quote });
    expect(limit).toBeNull();

    for (const hit of bruteForceMatches(body, quote)) {
      const covered = candidates.some(
        (candidate) => candidate.range.start < hit.end && hit.start < candidate.range.end,
      );
      expect(covered, `${JSON.stringify(body.slice(hit.start, hit.end))} was not offered`).toBe(
        true,
      );
    }
  });
});

describe("findReattachCandidates — honesty about its own limits", () => {
  it("says nothing resembles the quote rather than relaxing until something does", () => {
    const result = findReattachCandidates({
      body: "# Notes\n\nEntirely unrelated prose about shipping containers.\n",
      quote: "Review the Q2 report by Friday",
    });

    expect(result.candidates).toEqual([]);
    expect(result.limit).toBeNull();
  });

  it("reports a truncated list rather than returning a silent prefix", () => {
    const items = Array.from(
      { length: MAX_CANDIDATES + 6 },
      (_unused, index) => `- Review the R${String(index).padStart(2, "0")} report by Friday`,
    );
    const result = findReattachCandidates({
      body: items.join("\n"),
      quote: "Review the R99 report by Friday",
    });

    expect(result.candidates.length).toBe(MAX_CANDIDATES);
    expect(result.limit).toEqual({
      kind: "count",
      shown: MAX_CANDIDATES,
      found: MAX_CANDIDATES + 6,
    });
  });

  it("refuses a quote longer than it will search for, and says which", () => {
    const quote = "x".repeat(MAX_QUOTE_LENGTH + 1);
    expect(findReattachCandidates({ body: "anything", quote }).limit).toEqual({
      kind: "quote-too-long",
      length: MAX_QUOTE_LENGTH + 1,
      max: MAX_QUOTE_LENGTH,
    });
  });

  it("refuses a document whose search would not finish promptly, and says which", () => {
    const quote = "a".repeat(400);
    const body = "b".repeat(Math.ceil(SEARCH_CELL_BUDGET / (maxEdits(quote) + 2)) + 1);
    expect(findReattachCandidates({ body, quote }).limit).toEqual({ kind: "document-too-large" });
  });

  it("answers an empty quote or an empty body with an empty, complete list", () => {
    expect(findReattachCandidates({ body: "text", quote: "" })).toEqual({
      candidates: [],
      limit: null,
    });
    expect(findReattachCandidates({ body: "", quote: "text" })).toEqual({
      candidates: [],
      limit: null,
    });
  });
});

describe("findReattachCandidates — text another thread already claims", () => {
  const body = ["- Review the Q1 report by Friday", "- Review the Q3 report by Friday"].join("\n");
  const quote = "Review the Q2 report by Friday";

  it("shows the occupied passage and names its thread, rather than hiding it", () => {
    const { candidates } = findReattachCandidates({
      body,
      quote,
      occupied: [{ threadId: "th_other", range: { start: 2, end: 32 } }],
    });

    expect(candidates.length).toBe(2);
    expect(candidates[0]?.takenBy).toBe("th_other");
    expect(candidates[1]?.takenBy).toBeNull();
  });

  it("leaves every candidate unclaimed when nothing else is anchored", () => {
    const { candidates } = findReattachCandidates({ body, quote });
    expect(candidates.map((candidate) => candidate.takenBy)).toEqual([null, null]);
  });
});

describe("findReattachCandidates — surroundings", () => {
  const padding = Array.from(
    { length: 6 },
    (_unused, index) => `Paragraph ${String(index)}. ${"filler ".repeat(10)}`,
  );
  const body = [
    "# Weekly",
    ...padding,
    "- Review the Q1 report by Friday",
    "- Review the Q3 report by Friday",
    "- Review the Q4 report by Friday",
    ...padding,
  ].join("\n");

  it("carries whole neighbouring lines and flags where the document continues", () => {
    const { candidates } = findReattachCandidates({
      body,
      quote: "Review the Q3 report by Friday",
    });

    const middle = candidates.find((candidate) => candidate.text.includes("Q3"));
    expect(middle).toBeDefined();
    expect(middle?.before).toContain("Q1");
    expect(middle?.after).toContain("Q4");
    expect(middle?.precededByMore).toBe(true);
    expect(middle?.followedByMore).toBe(true);
  });

  it("reaches the document's edges without claiming there is more", () => {
    const short = "- alpha item\n- alpho item";
    const { candidates } = findReattachCandidates({ body: short, quote: "alpha item" });
    expect(candidates[0]?.precededByMore).toBe(false);
    expect(candidates.at(-1)?.followedByMore).toBe(false);
  });
});

describe("findReattachCandidates — an anchor born orphaned", () => {
  /**
   * UI-068's population: the quote never byte-matched because the selector
   * quoted a re-print of the document rather than its bytes. The text is right
   * there, and the exact occurrence must be offered like any other candidate —
   * offered, not applied.
   */
  it("offers the exact occurrence when one exists", () => {
    const body = "Ask about **lender spreads** before Thursday.\n";
    const { candidates } = findReattachCandidates({ body, quote: "lender spreads" });

    expect(textsOf(candidates)).toContain("lender spreads");
  });
});
