import { describe, expect, it } from "vitest";
import { TextQuoteSelectorSchema } from "@corpus/contract";
import { isWellFormedText } from "./code-points.js";
import { computeContext } from "./context.js";
import { computeOffsetMapper } from "./diff.js";
import { reconcileAnchors } from "./reconcile.js";
import { resolveAnchor, resolveAnchorExact } from "./resolve.js";
import type { AnchorsMap, Range, TextQuoteSelector } from "./types.js";

const SENTENCE = "assume a 30-year fixed at 6.1%";
const BODY = [
  "# Mortgage options",
  "",
  "We compared several lenders on their current offerings and fee structures.",
  "",
  "For the baseline the model we assume a 30-year fixed at 6.1% which may be stale by next quarter.",
  "",
  "Property taxes are held constant across all scenarios in this note.",
].join("\n");

/** Selector as the server's write path would create it: context from `computeContext`. */
const capture = (body: string, exact: string): TextQuoteSelector => {
  const start = body.indexOf(exact);
  if (start === -1) throw new Error(`fixture bug: ${JSON.stringify(exact)} not in body`);
  return { exact, ...computeContext(body, start, start + exact.length) };
};

const ANCHOR_ID = "anc_k4f7";
const anchorsFor = (body: string): AnchorsMap => ({ [ANCHOR_ID]: capture(body, SENTENCE) });

describe("reconcileAnchors — §15 M1 matrix", () => {
  it("edit strictly before the anchored range (outside the context window) → unchanged", () => {
    const newBody = BODY.replace(
      "# Mortgage options",
      "# Mortgage options\n\nA brand-new paragraph inserted well above the anchor.",
    );
    const { anchors, report } = reconcileAnchors(BODY, newBody, anchorsFor(BODY));
    expect(report).toEqual({ unchanged: [ANCHOR_ID], remapped: [], orphaned: [] });
    expect(anchors[ANCHOR_ID]).toEqual(anchorsFor(BODY)[ANCHOR_ID]);
    const range = resolveAnchor(newBody, anchors[ANCHOR_ID] ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe(SENTENCE);
  });

  it("edit strictly before, inside the context window → remapped, exact untouched", () => {
    const newBody = BODY.replace("the model we assume", "the model we now assume");
    const { anchors, report } = reconcileAnchors(BODY, newBody, anchorsFor(BODY));
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    expect(anchors[ANCHOR_ID]?.exact).toBe(SENTENCE);
    expect(anchors[ANCHOR_ID]?.prefix.endsWith("we now ")).toBe(true);
  });

  it("edit strictly after the anchored range → unchanged, selector untouched", () => {
    const newBody = `${BODY}\n\nAppended paragraph far below the anchored sentence.`;
    const { anchors, report } = reconcileAnchors(BODY, newBody, anchorsFor(BODY));
    expect(report).toEqual({ unchanged: [ANCHOR_ID], remapped: [], orphaned: [] });
    expect(anchors[ANCHOR_ID]).toEqual(anchorsFor(BODY)[ANCHOR_ID]);
  });

  it("edit inside the anchored range → remapped, exact quotes the edited text", () => {
    const newBody = BODY.replace("fixed at 6.1%", "fixed at 6.4%");
    const { anchors, report } = reconcileAnchors(BODY, newBody, anchorsFor(BODY));
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    expect(anchors[ANCHOR_ID]?.exact).toBe("assume a 30-year fixed at 6.4%");
    // The refreshed selector resolves in the new body via rung 1/2 (exact occurs verbatim).
    const range = resolveAnchor(newBody, anchors[ANCHOR_ID] ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe("assume a 30-year fixed at 6.4%");
  });

  it("anchored range deleted → orphaned, last selector preserved verbatim", () => {
    const input = anchorsFor(BODY);
    const newBody = BODY.replace(
      "\n\nFor the baseline the model we assume a 30-year fixed at 6.1% which may be stale by next quarter.",
      "",
    );
    const { anchors, report } = reconcileAnchors(BODY, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: [ANCHOR_ID] });
    expect(anchors[ANCHOR_ID]).toEqual(input[ANCHOR_ID]);
  });

  it("only the surrounding context changes → remapped, exact kept, context refreshed", () => {
    const newBody = BODY.replace(
      "For the baseline the model we assume",
      "Our planning assume",
    ).replace("6.1% which may be stale by next quarter.", "6.1% though rates move fast.");
    const { anchors, report } = reconcileAnchors(BODY, newBody, anchorsFor(BODY));
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    const selector = anchors[ANCHOR_ID];
    expect(selector?.exact).toBe(SENTENCE);
    expect(selector?.prefix.endsWith("Our planning ")).toBe(true);
    expect(selector?.suffix.startsWith(" though rates move")).toBe(true);
    const start = newBody.indexOf(SENTENCE);
    expect(selector?.prefix).toBe(computeContext(newBody, start, start + SENTENCE.length).prefix);
  });
});

describe("reconcileAnchors — deleted classification is verified before orphaning (SERVER-002 FAIL-1)", () => {
  // Evaluator fixture: an anchored sentence whose two neighbouring sentences
  // get rewritten. diff_cleanupSemantic merges the two rewrites into one
  // delete/insert that swallows the untouched sentence, so the mapper
  // classifies its range "deleted" — reconciliation must re-resolve through
  // the §6 ladder instead of trusting that claim.
  const SENT = "We assume a 30-year fixed at 6.1% for the base case.";
  const PRE = "The finance model has three inputs that matter most.";
  const POST = "Everything downstream depends on that number.";
  const oldBody = `\n# Mortgage options\n\n${PRE}\n\n${SENT}\n\n${POST}\n`;
  const input: AnchorsMap = { [ANCHOR_ID]: capture(oldBody, SENT) };

  it("both neighbouring sentences rewritten → remapped, exact kept, context refreshed", () => {
    const newBody = oldBody
      .replace(PRE, "Completely different words now precede the quoted line here.")
      .replace(POST, "Utterly different words now follow the quoted line as well.");
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    const selector = anchors[ANCHOR_ID];
    expect(selector?.exact).toBe(SENT);
    const start = newBody.indexOf(SENT);
    expect({ prefix: selector?.prefix, suffix: selector?.suffix }).toEqual(
      computeContext(newBody, start, start + SENT.length),
    );
    // The reconciler agrees with its own resolver.
    const range = resolveAnchor(newBody, selector ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe(SENT);
  });

  it("never orphans while the untouched sentence survives, across escalating context edits", () => {
    const edits: [string, string][] = [
      ["one word before", oldBody.replace("finance", "mortgage")],
      ["one word each side", oldBody.replace("finance", "mortgage").replace("downstream", "later")],
      [
        "preceding sentence rewritten",
        oldBody.replace(PRE, "Completely different words now precede the quoted line here."),
      ],
      [
        "both neighbouring sentences rewritten",
        oldBody
          .replace(PRE, "Completely different words now precede the quoted line here.")
          .replace(POST, "Utterly different words now follow the quoted line as well."),
      ],
    ];
    for (const [label, newBody] of edits) {
      const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
      expect(report.orphaned, label).toEqual([]);
      expect(anchors[ANCHOR_ID]?.exact, label).toBe(SENT);
    }
  });

  it("still orphans when the sentence is genuinely deleted along with both neighbours", () => {
    const newBody = oldBody
      .replace(`${PRE}\n\n${SENT}\n\n${POST}`, "")
      .concat("Completely different words replace the whole section now.\n");
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: [ANCHOR_ID] });
    expect(anchors[ANCHOR_ID]).toEqual(input[ANCHOR_ID]);
  });

  it("re-attaches a sentence cut from one place and pasted verbatim elsewhere", () => {
    // The diff sees a deletion at the old location, but §6 defines orphaned as
    // "no longer resolves" — a verbatim unique survivor re-attaches (rung 2).
    const newBody = `${oldBody.replace(`${SENT}\n\n`, "")}\n${SENT}\n`;
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    const selector = anchors[ANCHOR_ID];
    expect(selector?.exact).toBe(SENT);
    const start = newBody.lastIndexOf(SENT);
    expect(selector?.prefix).toBe(computeContext(newBody, start, start + SENT.length).prefix);
  });

  it("re-attaches through the degenerate whitespace-slice path when the exact re-appears in inserted text", () => {
    // Partial classification whose mapped slice is whitespace-only is a
    // deletion in all but name — it gets the same verification. Here the same
    // edit that blanked the anchored occurrence typed the text back in at the
    // end, so the unique exact match lives in inserted text: survival.
    const wsOld = "AAA xx      yy BBB and more prose stands.";
    const wsNew = "AAA        BBB and more prose stands. Moved: xx      yy here.";
    const { anchors, report } = reconcileAnchors(wsOld, wsNew, {
      anc_ws: capture(wsOld, "xx      yy"),
    });
    expect(report).toEqual({ unchanged: [], remapped: ["anc_ws"], orphaned: [] });
    expect(anchors["anc_ws"]?.exact).toBe("xx      yy");
    expect(anchors["anc_ws"]?.prefix.endsWith("Moved: ")).toBe(true);
  });

  it("orphans through the degenerate whitespace-slice path when the only exact match pre-existed elsewhere", () => {
    // Same blanking edit, but the surviving copy was already in the document
    // before the edit — a doppelgänger, not the anchored text moving. The
    // deletion stands (SPEC §6 step 5); the selector is preserved.
    const wsOld = "AAA xx      yy BBB and elsewhere xx      yy stands.";
    const wsNew = "AAA        BBB and elsewhere xx      yy stands.";
    const input: AnchorsMap = { anc_ws: capture(wsOld, "xx      yy") };
    const { anchors, report } = reconcileAnchors(wsOld, wsNew, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_ws"] });
    expect(anchors["anc_ws"]).toEqual(input["anc_ws"]);
  });
});

describe("reconcileAnchors — genuine deletions never re-attach to look-alikes (SERVER-002 FAIL-2)", () => {
  // Evaluator round-2 scenarios: the anchored text is genuinely deleted, but a
  // *similar sibling* (or a verbatim copy that was already there) exists.
  // Verification of the deleted-claim is exact-only and requires the match to
  // overlap inserted text — fuzzy similarity or a pre-existing doppelgänger
  // must never "verify" deleted text as surviving. Expected everywhere:
  // `orphaned`, selector byte-identical (SPEC §6 step 5, TEST-25).
  const expectOrphan = (oldBody: string, newBody: string, exact: string): void => {
    const input: AnchorsMap = { anc_gone: capture(oldBody, exact) };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_gone"] });
    expect(anchors["anc_gone"]).toEqual(input["anc_gone"]);
  };

  it("orphans a deleted paragraph despite two near-identical sibling paragraphs", () => {
    const paragraph = (n: string) =>
      `The ${n} paragraph discusses ${n} matters and nothing else whatsoever.`;
    const oldBody = `\n# Doc\n\n${["alpha", "bravo", "charlie"].map(paragraph).join("\n\n")}\n`;
    const newBody = oldBody.replace(`${paragraph("bravo")}\n\n`, "");
    expectOrphan(oldBody, newBody, paragraph("bravo"));
  });

  it("orphans a deleted bullet despite near-identical neighbouring bullets", () => {
    const bullet = (item: string) => `- Buy ${item} from the corner store on Tuesday.`;
    const oldBody = `\n# Shopping\n\n${bullet("milk")}\n${bullet("bread")}\n${bullet("eggs")}\n`;
    const newBody = oldBody.replace(`${bullet("bread")}\n`, "");
    expectOrphan(oldBody, newBody, bullet("bread"));
  });

  it("orphans a deleted table row despite similar sibling rows", () => {
    const oldBody = `\n# Quarters\n\n| quarter | revenue | churn |\n| ------- | ------- | ----- |\n| Q1 | 100 | 2% |\n| Q2 | 110 | 3% |\n| Q3 | 120 | 4% |\n`;
    const newBody = oldBody.replace("| Q2 | 110 | 3% |\n", "");
    expectOrphan(oldBody, newBody, "| Q2 | 110 | 3% |");
  });

  it("orphans a deleted sentence whose verbatim copy pre-existed elsewhere (doppelgänger)", () => {
    // The copy resolves exactly (rung 2, unique after the deletion) — but it
    // sits wholly in unedited text, so it is not the anchored text surviving.
    const sentence = "The retention clause survives termination of this agreement.";
    const oldBody = `\n# Contract\n\nOpening section.\n\n${sentence}\n\nMiddle prose about other clauses entirely.\n\nAppendix repeats it: ${sentence}\n`;
    const newBody = oldBody.replace(`${sentence}\n\nMiddle`, "Middle");
    expectOrphan(oldBody, newBody, sentence);
  });

  it("still re-attaches a cut-and-paste: the same exact text landing in inserted content", () => {
    // Counterpart to the doppelgänger case — here the edit itself carries the
    // text to its new home, so the unique exact match overlaps the insertion.
    const sentence = "The retention clause survives termination of this agreement.";
    const oldBody = `\n# Contract\n\nOpening section.\n\n${sentence}\n\nMiddle prose about other clauses entirely.\n`;
    const newBody = `${oldBody.replace(`${sentence}\n\n`, "")}\nRelocated: ${sentence}\n`;
    const input: AnchorsMap = { anc_move: capture(oldBody, sentence) };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_move"], orphaned: [] });
    expect(anchors["anc_move"]?.exact).toBe(sentence);
    expect(anchors["anc_move"]?.prefix.endsWith("Relocated: ")).toBe(true);
  });
});

describe("reconcileAnchors — partial-path slice integrity (SERVER-012)", () => {
  // Evaluator discovery (SERVER-002 eval, round 3, observation 2): deleting a
  // paragraph beside a near-identical paragraph that is *also edited* in the
  // same write makes the diff align the deleted paragraph against the edited
  // sibling. The mapper then hands each anchor a slice mapped through a
  // DELETE+INSERT replacement that straddles its range boundary — a truncated
  // selector (`exact: "Paragraph one now has orang"`) or the other anchor's
  // text. Such a slice is rejected and the anchor takes the deleted-claim
  // verification path (exact-only + insertion-overlap, fuzzy never).
  const P1 = "Paragraph one now has apples and pears in the basket today.";
  const P2 = "Paragraph two now has apples and pears in the basket today.";
  const base = `\n# Doc\n\n${P1}\n\n${P2}\n\nA closing paragraph that stays put.\n`;
  const siblingAnchors = (body: string): AnchorsMap => ({
    anc_one1: capture(body, P1),
    anc_two2: capture(body, P2),
  });

  it.each([
    [
      "delete P2, edit P1's word",
      (b: string) => b.replace(`\n\n${P2}`, "").replace("apples", "oranges"),
    ],
    [
      "delete P1, edit P2's word",
      (b: string) => b.replace(`${P1}\n\n`, "").replace("apples", "oranges"),
    ],
    [
      "delete P2, rewrite P1's tail",
      (b: string) =>
        b
          .replace(`\n\n${P2}`, "")
          .replace(
            "apples and pears in the basket today.",
            "oranges and figs in the basket tonight.",
          ),
    ],
    [
      "delete P1, rewrite P2's tail",
      (b: string) =>
        b
          .replace(`${P1}\n\n`, "")
          .replace(
            "apples and pears in the basket today.",
            "oranges and figs in the basket tonight.",
          ),
    ],
  ])("never emits a truncated selector or another anchor's text: %s", (_name, edit) => {
    const input = siblingAnchors(base);
    const newBody = edit(base);
    const { anchors, report } = reconcileAnchors(base, newBody, input);
    // TEST-60: each anchor is either remapped to the full text of its range or
    // orphaned with its selector preserved byte-for-byte — no third outcome.
    // Here neither original text survives verbatim, so both orphan.
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_one1", "anc_two2"] });
    expect(anchors["anc_one1"]).toEqual(input["anc_one1"]);
    expect(anchors["anc_two2"]).toEqual(input["anc_two2"]);
  });

  it("the reproduction fixture actually exercises the straddled-partial seam", () => {
    // Guard against fixture rot: the scenario must still classify `partial`
    // (not `deleted`) with a boundary-straddling replacement — the exact shape
    // the pre-fix engine turned into truncated selectors.
    const newBody = base.replace(`\n\n${P2}`, "").replace("apples", "oranges");
    const mapper = computeOffsetMapper(base, newBody);
    for (const exact of [P1, P2]) {
      const start = base.indexOf(exact);
      const range = { start, end: start + exact.length };
      expect(mapper.classify(range)).toBe("partial");
      expect(mapper.straddledByReplacement(range)).toBe(true);
    }
  });

  it("a rejected slice still verifies exactness: a pre-existing doppelgänger orphans, not re-attaches", () => {
    // The straddled anchor's exact resolves (rung 2 — the appendix copy is
    // unique after the deletion) but the match sits wholly in unedited text:
    // insertion-overlap rejects it, so the deletion stands. This pins the
    // fall-through to the adjudicated ladder — exact-only verification runs,
    // fuzzy never (the near-identical sibling would satisfy fuzzy).
    const oldBody = `${base}\nAppendix quotes it verbatim: ${P2} For the record.\n`;
    const newBody = oldBody
      .replace(`\n\n${P2}`, "")
      .replace("apples and pears", "oranges and figs");
    const input: AnchorsMap = { anc_two2: capture(oldBody, P2) };
    const mapper = computeOffsetMapper(oldBody, newBody);
    const start = oldBody.indexOf(P2);
    const range = { start, end: start + P2.length };
    expect(mapper.classify(range)).toBe("partial");
    expect(mapper.straddledByReplacement(range)).toBe(true);
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_two2"] });
    expect(anchors["anc_two2"]).toEqual(input["anc_two2"]);
  });

  it("still re-attaches when the same write re-types the deleted paragraph in inserted text", () => {
    // The verbatim copy lands amid enough new prose that the diff folds it
    // into the insertion; exact-only verification finds it overlapping
    // inserted text — survival, not a doppelgänger.
    const newBody =
      base.replace(`\n\n${P2}`, "").replace("apples", "oranges") +
      `\nFreshly written framing sentence with plenty of brand-new words before the quote. ${P2} And plenty of freshly written words after the quote close this paragraph out.\n`;
    const { anchors, report } = reconcileAnchors(base, newBody, siblingAnchors(base));
    expect(report.orphaned).toEqual([]);
    expect(anchors["anc_two2"]?.exact).toBe(P2);
    expect(anchors["anc_two2"]?.prefix.endsWith("before the quote. ")).toBe(true);
    // The surviving edited sibling keeps its own full paragraph.
    expect(anchors["anc_one1"]?.exact).toBe(P1.replace("apples", "oranges"));
  });

  it("both near-identical siblings deleted in one write → both orphan, no cross-contamination", () => {
    const input = siblingAnchors(base);
    const newBody = base.replace(`${P1}\n\n${P2}\n\n`, "");
    const { anchors, report } = reconcileAnchors(base, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_one1", "anc_two2"] });
    expect(anchors["anc_one1"]).toEqual(input["anc_one1"]);
    expect(anchors["anc_two2"]).toEqual(input["anc_two2"]);
  });

  const SHRINK_SENT = "We assume a 30-year fixed at 6.1% for the base case.";
  const SHRINK_BODY = `Intro line.\n\n${SHRINK_SENT}\n\nOutro line.\n`;

  it.each([
    [
      "in-range tail rewrite",
      (b: string) => b.replace("for the base case.", "going forward."),
      "We assume a 30-year fixed at 6.1% going forward.",
    ],
    [
      "shrink to a few words",
      (b: string) => b.replace(SHRINK_SENT, "We assume 6.1%."),
      "We assume 6.1%.",
    ],
    [
      "pure delete crossing the tail boundary",
      (b: string) => b.replace(" at 6.1% for the base case.\n\nOutro line.", "."),
      "We assume a 30-year fixed",
    ],
  ])("legitimate shrinking edits still remap: %s", (_name, edit, expected) => {
    // The invariant is "the slice equals what the selector claims", not "the
    // slice is long" — genuine shrinks (and pure deletions crossing the
    // boundary, which involve no replacement) keep trusting the mapper.
    const newBody = edit(SHRINK_BODY);
    const { anchors, report } = reconcileAnchors(SHRINK_BODY, newBody, {
      anc_s: capture(SHRINK_BODY, SHRINK_SENT),
    });
    expect(report).toEqual({ unchanged: [], remapped: ["anc_s"], orphaned: [] });
    expect(anchors["anc_s"]?.exact).toBe(expected);
    const range = resolveAnchor(newBody, anchors["anc_s"] ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe(expected);
  });
});

describe("reconcileAnchors — reorder family: cross-anchor slice honesty (SERVER-012 round 2)", () => {
  // Evaluator FAIL-1 (round 2): a whole-document reorder of near-identical
  // paragraphs makes the diff stuff an entire relocated paragraph into a
  // replacement wholly *inside* a range — boundary-respecting, so the straddle
  // guard cannot fire — and the mapped slice becomes a superset carrying a
  // neighbouring anchor's whole paragraph, with the two anchors' resolved
  // ranges overlapping. The cross-anchor honesty pass must reject such slices
  // and fall through the adjudicated chain.
  const P1 = "Paragraph one now has margin and cherries in the budget quarter.";
  const P2 = "Paragraph two now has margin and cherries in the budget quarter.";
  const P3 = "Paragraph three now has margin and cherries in the budget quarter.";
  const P4 = "Paragraph four now has margin and cherries in the budget quarter.";
  const oldBody = `\n# Doc\n\n${P1}\n\n${P2}\n\n${P3}\n\n${P4}\n\nA closing paragraph that stays put.\n`;
  const newBody = `\n# Doc\n\n${P4}\n\n${P3}\n\n${P2}\n\n${P1}\n\nA closing paragraph that stays put.\n`;
  const input: AnchorsMap = {
    anc_first: capture(oldBody, P1),
    anc_fourth: capture(oldBody, P4),
  };

  it("a reversed document re-attaches both anchors to their own relocated paragraphs", () => {
    // Pre-fix: anc_fourth's exact grew 65 → 130 chars, quoting P2 *and* P1,
    // and resolved to a range strictly containing anc_first's.
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_first", "anc_fourth"], orphaned: [] });
    expect(anchors["anc_first"]?.exact).toBe(P1);
    expect(anchors["anc_fourth"]?.exact).toBe(P4);
    const first = resolveAnchor(newBody, anchors["anc_first"] ?? { exact: "" });
    const fourth = resolveAnchor(newBody, anchors["anc_fourth"] ?? { exact: "" });
    expect(newBody.slice(first?.start, first?.end)).toBe(P1);
    expect(newBody.slice(fourth?.start, fourth?.end)).toBe(P4);
    // The observable harm of the bug: overlapping resolved ranges.
    expect(first).not.toBeNull();
    expect(fourth).not.toBeNull();
    expect(
      (first?.end ?? 0) <= (fourth?.start ?? 0) || (fourth?.end ?? 0) <= (first?.start ?? 0),
    ).toBe(true);
  });

  it("the reorder fixture exercises the non-straddled seam the round-1 guard cannot reach", () => {
    // Fixture-rot guard: the dishonest slice must come from a replacement
    // wholly inside the range (`partial`, not straddled) — the exact shape
    // that defeated `straddledByReplacement`.
    const mapper = computeOffsetMapper(oldBody, newBody);
    const start = oldBody.indexOf(P4);
    const range = { start, end: start + P4.length };
    expect(mapper.classify(range)).toBe("partial");
    expect(mapper.straddledByReplacement(range)).toBe(false);
  });

  it("a captured anchor whose paragraph has a pre-existing twin orphans, selector preserved", () => {
    // Re-routing goes through the adjudicated chain: exact-only, so a moved
    // paragraph that is no longer uniquely resolvable (a verbatim twin sits in
    // unedited text) orphans byte-for-byte instead of guessing — fuzzy never.
    const appendix = `Appendix repeats: ${P4}`;
    const twinOld = `${oldBody}\n${appendix}\n`;
    const twinNew = `${newBody}\n${appendix}\n`;
    const twinInput: AnchorsMap = {
      anc_first: capture(twinOld, P1),
      anc_fourth: capture(twinOld, P4),
    };
    const { anchors, report } = reconcileAnchors(twinOld, twinNew, twinInput);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_first"], orphaned: ["anc_fourth"] });
    expect(anchors["anc_fourth"]).toEqual(twinInput["anc_fourth"]);
    expect(anchors["anc_first"]?.exact).toBe(P1);
  });

  it("pre-existing nested anchors are exempt: an edited outer range may quote its inner anchor", () => {
    // The capture check only applies to anchors whose *old* ranges were
    // disjoint — nested/overlapping anchors are legal and move together.
    const SENT = "We assume a 30-year fixed at 6.1% for the base case.";
    const body = `Intro line.\n\n${SENT}\n\nOutro line.\n`;
    const nested: AnchorsMap = {
      anc_outer: capture(body, SENT),
      anc_inner: capture(body, "6.1%"),
    };
    const edited = body.replace("for the base case", "for the bull case");
    const { anchors, report } = reconcileAnchors(body, edited, nested);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_inner", "anc_outer"], orphaned: [] });
    expect(anchors["anc_outer"]?.exact).toBe(SENT.replace("base", "bull"));
    expect(anchors["anc_inner"]?.exact).toBe("6.1%");
  });

  it("rejects a slice whose emitted selector would resolve to an identical earlier window", () => {
    // Self-round-trip (acceptance criterion 2): an edit that makes the
    // anchored block byte-identical to an earlier block — including 32 chars
    // of context on each side — would emit a selector resolving to the FIRST
    // occurrence, silently moving the thread to the wrong section. The slice
    // is rejected; the original text is gone, so the anchor orphans.
    const block = (word: string) =>
      `The standard clause requires ${word} review before any release ships.`;
    const SEP = "\n\n---- standard divider used between every section ----\n\n";
    const shadowOld = `# Policy${SEP}${block("legal")}${SEP}${block("editorial")}${SEP}End.`;
    const shadowNew = shadowOld.replace("editorial", "legal");
    const start = shadowOld.indexOf(block("editorial"));
    const range = { start, end: start + block("editorial").length };
    const mapper = computeOffsetMapper(shadowOld, shadowNew);
    expect(mapper.classify(range)).toBe("partial");
    expect(mapper.straddledByReplacement(range)).toBe(false);
    const shadowInput: AnchorsMap = { anc_second: capture(shadowOld, block("editorial")) };
    const { anchors, report } = reconcileAnchors(shadowOld, shadowNew, shadowInput);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_second"] });
    expect(anchors["anc_second"]).toEqual(shadowInput["anc_second"]);
  });
});

describe("reconcileAnchors — substitution class: relocation evidence (SERVER-013)", () => {
  // Evaluator round-4 class: in a reorder, a `partial`-classified anchor is
  // handed a rewritten slice of *another paragraph's text* while its own
  // `exact` survives verbatim elsewhere — boundary-respecting and
  // self-round-tripping, and with a single anchor the cross-anchor pass has
  // nothing to compare against. The discriminator is the survivor's location:
  // disjoint from the slice AND overlapping inserted text → relocation, void
  // and re-place through the adjudicated chain; wholly in unedited text →
  // pre-existing duplicate, the mapper's slice stays trusted. Never similarity.
  const HIRE =
    "Hiring velocity stalled around the hiring committee's bar, before the budget review lands.";
  const CASH =
    "Cash runway stalled around nineteen months of burn, assuming no new debt this year.";
  const OPS = [
    "Revenue grew past the enterprise tier forecast, according to the latest close.",
    "Churn held steady near two point one percent, despite the pricing change in May.",
    "The support backlog dropped below forty open tickets, per the operating plan.",
    HIRE,
    "Marketing spend shifted toward developer conferences this spring, though the data lags a week.",
    CASH,
  ];
  const opsDoc = (ps: string[]): string => `# Q3 operations review\n\n${ps.join("\n\n")}\n`;
  const OPS_OLD = opsDoc(OPS);
  const OPS_SWAPPED = ((): string => {
    const next = [...OPS];
    [next[3], next[5]] = [CASH, HIRE];
    return opsDoc(next);
  })();

  it("six wholly-distinct paragraphs, #4 and #6 swapped, one anchor → re-attaches to its own moved text (TEST-57/59)", () => {
    const input: AnchorsMap = { anc_hire: capture(OPS_OLD, HIRE) };
    const { anchors, report } = reconcileAnchors(OPS_OLD, OPS_SWAPPED, input);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_hire"], orphaned: [] });
    expect(anchors["anc_hire"]?.exact).toBe(HIRE);
    // "Its own moved text": the resolved range is where the paragraph landed —
    // not merely `newBody.includes(exact)`, the discredited predicate.
    const range = resolveAnchor(OPS_SWAPPED, anchors["anc_hire"] ?? { exact: "" });
    expect(range?.start).toBe(OPS_SWAPPED.indexOf(HIRE));
    expect(OPS_SWAPPED.slice(range?.start, range?.end)).toBe(HIRE);
  });

  it("the fixture exercises the substitution seam: partial, unstraddled, and mapped onto the other paragraph", () => {
    // Fixture-rot guard. The diff must hand the anchor the *cash* paragraph's
    // text through a boundary-respecting partial — the exact shape the shipped
    // engine trusted (its emitted exact was CASH, per the on-disk repro).
    const mapper = computeOffsetMapper(OPS_OLD, OPS_SWAPPED);
    const start = OPS_OLD.indexOf(HIRE);
    const range = { start, end: start + HIRE.length };
    expect(mapper.classify(range)).toBe("partial");
    expect(mapper.straddledByReplacement(range)).toBe(false);
    const slice = OPS_SWAPPED.slice(mapper.mapStart(range.start), mapper.mapEnd(range.end));
    expect(slice).toBe(CASH);
  });

  it("round-4 minimal: two near-identical paragraphs swapped, ONE anchor → its own text, not the sibling's (TEST-62)", () => {
    // With a single anchor the round-2 cross-anchor pass cannot fire — this is
    // the hand-verified reproduction from the round-4 evaluation.
    const P1 = "Paragraph one now has margin and cherries in the budget quarter.";
    const P2 = "Paragraph two now has margin and cherries in the budget quarter.";
    const oldBody = `\n# Doc\n\n${P1}\n\n${P2}\n\nA closing paragraph that stays put.\n`;
    const newBody = `\n# Doc\n\n${P2}\n\n${P1}\n\nA closing paragraph that stays put.\n`;
    const input: AnchorsMap = { anc_0001: capture(oldBody, P1) };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_0001"], orphaned: [] });
    expect(anchors["anc_0001"]?.exact).toBe(P1);
    const range = resolveAnchor(newBody, anchors["anc_0001"] ?? { exact: "" });
    expect(range?.start).toBe(newBody.indexOf(P1));
  });

  const DUP_SENT = "We assume a 30-year fixed at 6.1% for the base case.";
  const dupBody = `\n# Doc\n\nLead paragraph stays.\n\n${DUP_SENT}\n\nTail paragraph stays.\n\nAppendix: ${DUP_SENT}\n`;

  it.each([
    [
      "shrink to a few words",
      (b: string) => b.replace(DUP_SENT, "We assume 6.1%."),
      "We assume 6.1%.",
    ],
    [
      "heavy in-place rewrite",
      (b: string) =>
        b.replace(DUP_SENT, "We assume nothing is safe; rates moved and 6.1% no longer holds."),
      "We assume nothing is safe; rates moved and 6.1% no longer holds.",
    ],
    [
      "medium in-place rewrite",
      (b: string) => b.replace(DUP_SENT, "We assume a 30-year floating at 6.4% for the bull case."),
      "We assume a 30-year floating at 6.4% for the bull case.",
    ],
    [
      "boundary-crossing pure delete",
      (b: string) => b.replace(" at 6.1% for the base case.\n\nTail paragraph stays.", "."),
      "We assume a 30-year fixed",
    ],
  ])(
    "an in-place edit with a verbatim duplicate elsewhere stays remapped in place: %s (TEST-61/63)",
    (_name, edit, expected) => {
      // The round-3 anti-goal: `lacksKinship` orphaned 404/600 of these. The
      // duplicate sits wholly in unedited (EQUAL) text — a pre-existing
      // doppelgänger, not this anchor's text surviving — so the in-place edit
      // evidence outranks it (SERVER-002 adjudication) and the anchor never
      // orphans and never jumps to the appendix.
      const first = dupBody.indexOf(DUP_SENT);
      const input: AnchorsMap = {
        anc_dup: { exact: DUP_SENT, ...computeContext(dupBody, first, first + DUP_SENT.length) },
      };
      const newBody = edit(dupBody);
      const { anchors, report } = reconcileAnchors(dupBody, newBody, input);
      expect(report).toEqual({ unchanged: [], remapped: ["anc_dup"], orphaned: [] });
      expect(anchors["anc_dup"]?.exact).toBe(expected);
      const range = resolveAnchor(newBody, anchors["anc_dup"] ?? { exact: "" });
      expect(newBody.slice(range?.start, range?.end)).toBe(expected);
      // Never the appendix copy: the resolved range precedes it.
      expect(range?.end).toBeLessThanOrEqual(newBody.indexOf("Appendix: "));
    },
  );

  it("EQUAL-text survivor + wholly rewritten slice keeps the mapper's slice — the adjudicated corner (68c must-not-fix)", () => {
    // A rewrite sharing only fragments with the original, while a verbatim
    // duplicate pre-exists in unedited text. Orphaning here would need an
    // unrelatedness signal — the similarity trap. The authorized design trusts
    // the mapper for EQUAL survivors, byte-identical to the shipped engine.
    const newBody = dupBody.replace(
      DUP_SENT,
      "Everything was renegotiated after the audit; we keep only the 6.1% figure.",
    );
    const first = dupBody.indexOf(DUP_SENT);
    const input: AnchorsMap = {
      anc_dup: { exact: DUP_SENT, ...computeContext(dupBody, first, first + DUP_SENT.length) },
    };
    const { anchors, report } = reconcileAnchors(dupBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: ["anc_dup"], orphaned: [] });
    expect(anchors["anc_dup"]?.exact).toBe(
      "Everything was renegotiated after the audit; we keep only the 6.1% figure.",
    );
  });

  it("true duplication during a reorder leaves the mapper's choice standing (TEST-65)", () => {
    // Both the mapped location and an INSERT location hold verbatim copies —
    // there is no evidence the mapper is wrong, so nothing is voided.
    const [A, B, C] = [OPS[0]!, OPS[1]!, OPS[2]!];
    const oldBody = `# Doc\n\n${A}\n\n${HIRE}\n\n${B}\n\n${C}\n`;
    const newBody = `# Doc\n\n${A}\n\n${HIRE}\n\n${C}\n\n${B}\n\nQuoted again: ${HIRE}\n`;
    const input: AnchorsMap = { anc_t: capture(oldBody, HIRE) };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report.orphaned).toEqual([]);
    expect(anchors["anc_t"]?.exact).toBe(HIRE);
    // The emitted context still names the original neighbourhood.
    const range = resolveAnchor(newBody, anchors["anc_t"] ?? { exact: "" });
    expect(range?.start).toBe(newBody.indexOf(HIRE));
  });

  it("a non-unique survivor goes through the chain's uniqueness rules: ambiguity orphans, selector preserved (TEST-64)", () => {
    // The anchored paragraph relocates, but a verbatim twin already sat in
    // unedited text: after the reorder the exact resolves nowhere uniquely and
    // the old context survives nowhere, so re-placement refuses to pick an
    // occurrence arbitrarily — and never picks by similarity.
    const twinDoc = `${OPS_OLD}\nAppendix repeats: ${HIRE}\n`;
    const twinNew = `${OPS_SWAPPED}\nAppendix repeats: ${HIRE}\n`;
    const input: AnchorsMap = { anc_hire: capture(twinDoc, HIRE) };
    const { anchors, report } = reconcileAnchors(twinDoc, twinNew, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_hire"] });
    expect(anchors["anc_hire"]).toEqual(input["anc_hire"]);
  });

  it("musical chairs: two anchors on byte-identical paragraphs keep distinct, order-preserving ranges", () => {
    const T = "The repeated boilerplate disclaimer applies to this section.";
    const [A, B, C] = [OPS[0]!, OPS[1]!, OPS[2]!];
    const oldBody = `# Doc\n\n${A}\n\n${T}\n\n${B}\n\n${T}\n\n${C}\n`;
    const newBody = `# Doc\n\n${C}\n\n${T}\n\n${B}\n\n${T}\n\n${A}\n`;
    const first = oldBody.indexOf(T);
    const second = oldBody.indexOf(T, first + 1);
    const input: AnchorsMap = {
      anc_a: { exact: T, ...computeContext(oldBody, first, first + T.length) },
      anc_b: { exact: T, ...computeContext(oldBody, second, second + T.length) },
    };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report.orphaned).toEqual([]);
    const ra = resolveAnchor(newBody, anchors["anc_a"] ?? { exact: "" });
    const rb = resolveAnchor(newBody, anchors["anc_b"] ?? { exact: "" });
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(newBody.slice(ra?.start, ra?.end)).toBe(T);
    expect(newBody.slice(rb?.start, rb?.end)).toBe(T);
    expect(ra?.start).toBeLessThan(rb?.start ?? 0);
  });

  it("nested anchors on a relocated paragraph move together (nested exemption, reordered)", () => {
    const input: AnchorsMap = {
      anc_inner: capture(OPS_OLD, "the hiring committee's bar"),
      anc_outer: capture(OPS_OLD, HIRE),
    };
    const { anchors, report } = reconcileAnchors(OPS_OLD, OPS_SWAPPED, input);
    expect(report.orphaned).toEqual([]);
    const outer = resolveAnchor(OPS_SWAPPED, anchors["anc_outer"] ?? { exact: "" });
    const inner = resolveAnchor(OPS_SWAPPED, anchors["anc_inner"] ?? { exact: "" });
    expect(OPS_SWAPPED.slice(outer?.start, outer?.end)).toBe(HIRE);
    expect(OPS_SWAPPED.slice(inner?.start, inner?.end)).toBe("the hiring committee's bar");
    expect(inner?.start).toBeGreaterThanOrEqual(outer?.start ?? 0);
    expect(inner?.end).toBeLessThanOrEqual(outer?.end ?? 0);
  });

  it.each([
    ["one paragraph inserted between", ["A freshly written interlude paragraph sits here now."]],
    [
      "two paragraphs inserted between",
      [
        "A freshly written interlude paragraph sits here now.",
        "And a second brand-new paragraph follows it immediately.",
      ],
    ],
  ])(
    "cut-and-paste far away still re-attaches to its own moved text: %s (TEST-67c)",
    (_name, inserted) => {
      const SENT = "We assume a 30-year fixed at 6.1% for the base case.";
      const PRE = "The finance model has three inputs that matter most.";
      const POST = "Everything downstream depends on that number.";
      const TAIL = "A closing paragraph that stays in place below everything.";
      const oldBody = `\n# Doc\n\n${PRE}\n\n${SENT}\n\n${POST}\n\n${TAIL}\n`;
      const newBody = `\n# Doc\n\n${PRE}\n\n${POST}\n\n${inserted.join("\n\n")}\n\n${SENT}\n\n${TAIL}\n`;
      const input: AnchorsMap = { anc_move: capture(oldBody, SENT) };
      const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
      expect(report).toEqual({ unchanged: [], remapped: ["anc_move"], orphaned: [] });
      expect(anchors["anc_move"]?.exact).toBe(SENT);
      const range = resolveAnchor(newBody, anchors["anc_move"] ?? { exact: "" });
      expect(range?.start).toBe(newBody.indexOf(SENT));
    },
  );

  it("is order-independent: anchor key order never changes the outcome", () => {
    const selectors: [string, ReturnType<typeof capture>][] = [
      ["anc_hire", capture(OPS_OLD, HIRE)],
      ["anc_cash", capture(OPS_OLD, CASH)],
      ["anc_rev", capture(OPS_OLD, OPS[0]!)],
    ];
    const permutations = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [2, 0, 1],
    ];
    const results = permutations.map((perm) => {
      const input: AnchorsMap = {};
      for (const i of perm) {
        const [id, sel] = selectors[i]!;
        input[id] = sel;
      }
      return JSON.stringify(reconcileAnchors(OPS_OLD, OPS_SWAPPED, input));
    });
    for (const result of results) expect(result).toBe(results[0]);
  });
});

describe("reconcileAnchors — guarantees", () => {
  it("is deterministic: 100 runs on identical inputs serialize byte-identically", () => {
    const anchors: AnchorsMap = {
      anc_e1: capture(BODY, SENTENCE),
      anc_a2: capture(BODY, "several lenders"),
      anc_c3: capture(BODY, "Property taxes are held constant"),
      anc_b4: { exact: "text that never existed in the old body" },
      anc_d5: capture(BODY, "# Mortgage options"),
    };
    const newBody = BODY.replace("# Mortgage options", "# Refinancing options").replace(
      "\n\nProperty taxes are held constant across all scenarios in this note.",
      "",
    );
    const first = JSON.stringify(reconcileAnchors(BODY, newBody, anchors));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(reconcileAnchors(BODY, newBody, anchors))).toBe(first);
    }
    const { report } = reconcileAnchors(BODY, newBody, anchors);
    expect(report.orphaned).toContain("anc_b4");
    expect(report.orphaned).toContain("anc_c3");
  });

  it("never mutates its input and returns distinct objects", () => {
    const anchors: AnchorsMap = { [ANCHOR_ID]: capture(BODY, SENTENCE) };
    const snapshot = structuredClone(anchors);
    const result = reconcileAnchors(BODY, BODY.replace("6.1%", "7.0%"), anchors);
    expect(result.anchors).not.toBe(anchors);
    result.anchors[ANCHOR_ID] = { exact: "clobbered", prefix: "", suffix: "" };
    result.report.orphaned.push("anc_fake");
    expect(anchors).toEqual(snapshot);
  });

  it("never re-attaches an anchor that was already orphaned before the edit", () => {
    const selector: TextQuoteSelector = {
      exact: "a sentence that is not in the old body",
      prefix: "lead ",
      suffix: " tail",
    };
    const oldBody = "Entirely different prose with nothing to match.";
    const newBody = "Now containing a sentence that is not in the old body verbatim.";
    const { anchors, report } = reconcileAnchors(oldBody, newBody, { anc_gone: selector });
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_gone"] });
    expect(anchors["anc_gone"]).toEqual(selector);
  });

  it("orphans every anchor when the whole body is replaced — no spurious fuzzy matches", () => {
    const anchors: AnchorsMap = {
      anc_a: capture(BODY, SENTENCE),
      anc_b: capture(BODY, "several lenders"),
    };
    const newBody = "Utterly unrelated replacement content about gardening and soil pH.";
    const { report } = reconcileAnchors(BODY, newBody, anchors);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_a", "anc_b"] });
  });

  it("handles an emptied and an empty old body without throwing", () => {
    const anchors = anchorsFor(BODY);
    expect(reconcileAnchors(BODY, "", anchors).report.orphaned).toEqual([ANCHOR_ID]);
    expect(reconcileAnchors("", "fresh content", anchors).report.orphaned).toEqual([ANCHOR_ID]);
  });

  it("returns an empty result for an empty anchors map", () => {
    expect(reconcileAnchors(BODY, `${BODY} more`, {})).toEqual({
      anchors: {},
      report: { unchanged: [], remapped: [], orphaned: [] },
    });
  });

  it("orphans a range partially edited down to whitespace", () => {
    const oldBody = "AAA xx      yy BBB";
    const newBody = "AAA        BBB";
    const input: AnchorsMap = { anc_ws: capture(oldBody, "xx      yy") };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report.orphaned).toEqual(["anc_ws"]);
    expect(anchors["anc_ws"]).toEqual(input["anc_ws"]);
  });

  it("reconciles adjacent and overlapping anchors independently", () => {
    const oldBody = "Start. the quick brown fox jumps over the lazy dog. End.";
    const anchors: AnchorsMap = {
      anc_left: capture(oldBody, "quick brown"),
      anc_right: capture(oldBody, "brown fox jumps"),
      anc_adj: capture(oldBody, " over the"),
    };
    const newBody = oldBody.replace("lazy dog", "sleeping cat");
    const { anchors: next, report } = reconcileAnchors(oldBody, newBody, anchors);
    expect(report.orphaned).toEqual([]);
    for (const id of ["anc_left", "anc_right", "anc_adj"] as const) {
      const range = resolveAnchor(newBody, next[id] ?? { exact: "" });
      expect(range).not.toBeNull();
      expect(newBody.slice(range?.start, range?.end)).toBe(next[id]?.exact);
    }
  });

  it("treats absent and empty-string context as equivalent on input, emits strings", () => {
    const oldBody = "unique anchored fragment surrounded by words";
    const withAbsent = reconcileAnchors(oldBody, oldBody, {
      anc_x: { exact: "unique anchored fragment" },
    });
    const withEmpty = reconcileAnchors(oldBody, oldBody, {
      anc_x: { exact: "unique anchored fragment", prefix: "", suffix: "" },
    });
    expect(withAbsent).toEqual(withEmpty);
    expect(typeof withAbsent.anchors["anc_x"]?.prefix).toBe("string");
    expect(typeof withAbsent.anchors["anc_x"]?.suffix).toBe("string");
  });

  it("emits selectors that satisfy the contract's TextQuoteSelectorSchema, including empty context at a body boundary", () => {
    const oldBody = `${SENTENCE} opens this body and more text follows after it.`;
    const anchors: AnchorsMap = { anc_start: capture(oldBody, SENTENCE) };
    expect(anchors["anc_start"]?.prefix).toBe("");
    const newBody = `${oldBody}\n\nAppended paragraph.`;
    const result = reconcileAnchors(oldBody, newBody, anchors);
    for (const selector of Object.values(result.anchors)) {
      expect(() => TextQuoteSelectorSchema.parse(selector)).not.toThrow();
    }
    expect(result.anchors["anc_start"]?.prefix).toBe("");
    expect(result.report.unchanged).toEqual(["anc_start"]);
  });

  it("remaps rather than orphans across a CRLF → LF conversion", () => {
    const oldBody = BODY.replaceAll("\n", "\r\n");
    const newBody = BODY;
    const input: AnchorsMap = { [ANCHOR_ID]: capture(oldBody, SENTENCE) };
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report.orphaned).toEqual([]);
    const range = resolveAnchor(newBody, anchors[ANCHOR_ID] ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe(anchors[ANCHOR_ID]?.exact);
  });

  it("keeps every offset on code-point boundaries around astral/RTL/combining text", () => {
    const oldBody =
      "עברית intro 🎉 the anchored ✍️ sentence 🚀 sits between emoji 🌍 and café́ text.";
    const exact = "the anchored ✍️ sentence";
    const input: AnchorsMap = { anc_u: capture(oldBody, exact) };
    const newBody = oldBody.replace("anchored ✍️ sentence", "anchored ✍️ edited sentence");
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    expect(report.remapped).toEqual(["anc_u"]);
    const selector = anchors["anc_u"];
    for (const field of [selector?.exact, selector?.prefix, selector?.suffix]) {
      expect(field).toBeDefined();
      expect(isWellFormedText(field ?? "")).toBe(true);
    }
    const range = resolveAnchor(newBody, selector ?? { exact: "" });
    expect(newBody.slice(range?.start, range?.end)).toBe(selector?.exact);
  });
});

describe("reconcileAnchors — property sweep (seeded)", () => {
  const makeRng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  };

  // Every sweep fixture anchors disjoint old ranges, so any overlap among the
  // emitted anchors' resolved ranges was *created* by reconciliation — the
  // observable harm of the SERVER-012 round-2 reorder family.
  const expectNoNewOverlaps = (resolved: Record<string, Range>, label: string): void => {
    const entries = Object.entries(resolved);
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        const [idA, rangeA] = entries[a] ?? ["", { start: 0, end: 0 }];
        const [idB, rangeB] = entries[b] ?? ["", { start: 0, end: 0 }];
        expect(
          rangeA.start < rangeB.end && rangeB.start < rangeA.end,
          `${label}: ${idA} overlaps ${idB}`,
        ).toBe(false);
      }
    }
  };

  it("holds the report invariants across 40 seeded random edits", () => {
    const words = ["alpha", "refit", "quarterly", "\n\n", "rates ", "— beta —", "🎉", "x"];
    const anchors: AnchorsMap = {
      anc_e1: capture(BODY, SENTENCE),
      anc_a2: capture(BODY, "several lenders"),
      anc_c3: capture(BODY, "held constant across all scenarios"),
      anc_pre: { exact: "never present in the fixture body" },
    };
    const normalized = Object.fromEntries(
      Object.entries(anchors).map(([id, s]) => [
        id,
        { exact: s.exact, prefix: s.prefix ?? "", suffix: s.suffix ?? "" },
      ]),
    );
    for (let run = 0; run < 40; run++) {
      const rng = makeRng(run + 1);
      let newBody = BODY;
      const editCount = 1 + Math.floor(rng() * 3);
      for (let e = 0; e < editCount; e++) {
        const at = Math.floor(rng() * newBody.length);
        const op = rng();
        if (op < 0.34) {
          const word = words[Math.floor(rng() * words.length)] ?? "pad";
          newBody = `${newBody.slice(0, at)}${word}${newBody.slice(at)}`;
        } else if (op < 0.67) {
          const len = Math.floor(rng() * 30);
          newBody = `${newBody.slice(0, at)}${newBody.slice(at + len)}`;
        } else {
          const len = Math.floor(rng() * 15);
          const word = words[Math.floor(rng() * words.length)] ?? "pad";
          newBody = `${newBody.slice(0, at)}${word}${newBody.slice(at + len)}`;
        }
      }
      const { anchors: next, report } = reconcileAnchors(BODY, newBody, anchors);
      for (const id of [...report.unchanged, ...report.remapped]) {
        const selector = next[id];
        expect(selector).toBeDefined();
        // A surviving selector always resolves in the new body: its context and
        // exact were taken verbatim from it — and the resolved range's full
        // text is the selector's exact, never a truncation or another range's
        // text (SERVER-012 slice-integrity invariant, sprint-002 TEST-61).
        const range = resolveAnchor(newBody, selector ?? { exact: "" });
        expect(range, `seed ${run + 1}: ${id}`).not.toBeNull();
        expect(newBody.slice(range?.start, range?.end), `seed ${run + 1}: ${id}`).toBe(
          selector?.exact,
        );
      }
      for (const id of report.orphaned) {
        expect(next[id], `seed ${run + 1}: ${id}`).toEqual(normalized[id]);
      }
      expect([...report.unchanged, ...report.remapped, ...report.orphaned].sort()).toEqual(
        Object.keys(anchors).sort(),
      );
    }
  });

  it("holds slice integrity across 40 seeded edits of a body full of near-identical siblings", () => {
    // The SERVER-012 failure shape needs look-alike blocks for the diff to
    // cross-align, so the general invariant is also swept over a body where
    // every paragraph has a near-identical sibling. Random deletions and
    // replacements here routinely straddle anchor boundaries.
    const paragraph = (n: string, k: string) =>
      `Paragraph ${n} now has ${k} and pears in the basket today.`;
    const body = [
      "# Doc",
      paragraph("one", "apples"),
      paragraph("two", "apples"),
      paragraph("three", "plums"),
      paragraph("four", "plums"),
      "A closing paragraph that stays put.",
    ].join("\n\n");
    const anchors: AnchorsMap = {
      anc_p1: capture(body, paragraph("one", "apples")),
      anc_p2: capture(body, paragraph("two", "apples")),
      anc_p3: capture(body, paragraph("three", "plums")),
      anc_p4: capture(body, paragraph("four", "plums")),
    };
    const normalized = Object.fromEntries(
      Object.entries(anchors).map(([id, s]) => [
        id,
        { exact: s.exact, prefix: s.prefix ?? "", suffix: s.suffix ?? "" },
      ]),
    );
    const words = ["oranges", "\n\nParagraph five now has kiwis too.", " figs ", "x"];
    for (let run = 0; run < 40; run++) {
      const rng = makeRng(run + 101);
      let newBody = body;
      const editCount = 1 + Math.floor(rng() * 3);
      for (let e = 0; e < editCount; e++) {
        const at = Math.floor(rng() * newBody.length);
        const len = Math.floor(rng() * 70);
        const word = rng() < 0.5 ? "" : (words[Math.floor(rng() * words.length)] ?? "pad");
        newBody = `${newBody.slice(0, at)}${word}${newBody.slice(at + len)}`;
      }
      const { anchors: next, report } = reconcileAnchors(body, newBody, anchors);
      const resolved: Record<string, Range> = {};
      for (const id of [...report.unchanged, ...report.remapped]) {
        const selector = next[id];
        const range = resolveAnchor(newBody, selector ?? { exact: "" });
        expect(range, `seed ${run + 101}: ${id}`).not.toBeNull();
        if (range !== null) resolved[id] = range;
        expect(newBody.slice(range?.start, range?.end), `seed ${run + 101}: ${id}`).toBe(
          selector?.exact,
        );
      }
      expectNoNewOverlaps(resolved, `seed ${run + 101}`);
      for (const id of report.orphaned) {
        expect(next[id], `seed ${run + 101}: ${id}`).toEqual(normalized[id]);
      }
      expect([...report.unchanged, ...report.remapped, ...report.orphaned].sort()).toEqual(
        Object.keys(anchors).sort(),
      );
    }
  });

  it("holds slice integrity across 40 seeded reorders of near-identical siblings", () => {
    // The round-2 failure family (evaluator FAIL-1): whole-document reorders.
    // The repo sweep above was green while this family failed at 6/1000 in an
    // independent sweep purely because its generator never emitted reorders —
    // so reorder shapes get their own seeded sweep, asserting the general
    // invariant AND the observable harm directly: anchors whose old ranges
    // were disjoint never resolve to overlapping ranges, and no emitted exact
    // contains another anchor's entire original text.
    const paragraph = (n: string, k: string) =>
      `Paragraph ${n} now has ${k} and cherries in the budget quarter.`;
    const ordinals = ["one", "two", "three", "four", "five"];
    const fruits = ["margin", "apples", "plums", "margin", "apples"];
    for (let run = 0; run < 40; run++) {
      const rng = makeRng(run + 201);
      const n = 4 + Math.floor(rng() * 2);
      const paragraphs = ordinals.slice(0, n).map((o, i) => paragraph(o, fruits[i] ?? "margin"));
      const rebuild = (blocks: string[]) =>
        `\n# Doc\n\n${blocks.join("\n\n")}\n\nA closing paragraph that stays put.\n`;
      const body = rebuild(paragraphs);
      const anchors: AnchorsMap = {};
      for (const [i, text] of paragraphs.entries()) anchors[`anc_p${i}`] = capture(body, text);

      let next = [...paragraphs];
      const shape = Math.floor(rng() * 4);
      if (shape === 0) next.reverse();
      else if (shape === 1) {
        const k = 1 + Math.floor(rng() * (n - 1));
        next = [...next.slice(k), ...next.slice(0, k)];
      } else if (shape === 2) {
        const i = Math.floor(rng() * n);
        const j = (i + 1 + Math.floor(rng() * (n - 1))) % n;
        const [a, b] = [next[i], next[j]];
        if (a !== undefined && b !== undefined) [next[i], next[j]] = [b, a];
      } else {
        for (let i = next.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const [a, b] = [next[i], next[j]];
          if (a !== undefined && b !== undefined) [next[i], next[j]] = [b, a];
        }
      }
      let newBody = rebuild(next);
      if (rng() < 0.5) newBody = newBody.replace("cherries", "sultanas");

      const { anchors: out, report } = reconcileAnchors(body, newBody, anchors);
      const resolved: Record<string, Range> = {};
      for (const id of [...report.unchanged, ...report.remapped]) {
        const selector = out[id];
        const range = resolveAnchor(newBody, selector ?? { exact: "" });
        expect(range, `seed ${run + 201}: ${id}`).not.toBeNull();
        if (range !== null) resolved[id] = range;
        expect(newBody.slice(range?.start, range?.end), `seed ${run + 201}: ${id}`).toBe(
          selector?.exact,
        );
        for (const other of Object.keys(anchors)) {
          if (other === id) continue;
          expect(
            out[id]?.exact.includes(anchors[other]?.exact ?? " "),
            `seed ${run + 201}: ${id} quotes ${other}'s paragraph`,
          ).toBe(false);
        }
      }
      expectNoNewOverlaps(resolved, `seed ${run + 201}`);
      for (const id of report.orphaned) {
        const original = anchors[id];
        expect(out[id], `seed ${run + 201}: ${id}`).toEqual({
          exact: original?.exact ?? "",
          prefix: original?.prefix ?? "",
          suffix: original?.suffix ?? "",
        });
      }
      expect([...report.unchanged, ...report.remapped, ...report.orphaned].sort()).toEqual(
        Object.keys(anchors).sort(),
      );
    }
  });
});

describe("reconcileAnchors — duplicate-survivor fast path: the mapper's causal choice is blessed (SERVER-014)", () => {
  // The SERVER-013-eval TEST-64 escalation, 4-step reproduction. Unlike the
  // fixture at "a non-unique survivor goes through the chain's uniqueness
  // rules (TEST-64)" above — where the exact already occurred TWICE in
  // `oldBody`, the anchor's own occurrence relocates, the range classifies
  // "deleted" and `verifiedSurvivor` orphans — here B occurs ONCE in
  // `oldBody` and is duplicated only as an artifact of the edit. The range
  // classifies `equal`, the mapped slice is byte-identical to the exact, and
  // the engine takes the trusted-slice fast path (`newRange: mapped`)
  // without ever consulting the uniqueness rules. SPEC.md §6 as amended
  // (SHARED-002) blesses that outcome: B's text is not "genuinely gone", the
  // diff's positional alignment is the demonstration that the text was
  // carried forward, and `prefix`/`suffix` refreshed is REQUIRED of a remap
  // — byte-preservation of the whole selector is promised for orphans only.
  const A = "Alpha section covers onboarding rituals and the welcome checklist.";
  const B = "Bravo section explains the quarterly budget review and its sign-off flow.";
  const C = "Charlie section documents incident escalation paths for the on-call rota.";
  const D = "Delta section closes with archival policy and retention timelines.";
  const oldBody = `# Doc\n\n${A}\n\n${B}\n\n${C}\n\n${D}\n`;
  const newBody = `# Doc\n\n${C}\n\n${B}\n\n${A}\n\n${B}\n\n${D}\n`;
  const input: AnchorsMap = { anc_b: capture(oldBody, B) };

  it("probe: the fixture exercises the trusted-slice fast path, where the chain would have orphaned", () => {
    // B is duplicated by the edit (occurrence count 2 in newBody, 1 in oldBody)…
    const first = newBody.indexOf(B);
    expect(oldBody.indexOf(B, oldBody.indexOf(B) + 1)).toBe(-1);
    expect(newBody.indexOf(B, first + 1)).toBeGreaterThan(first);
    // …the classification is `equal` (not "deleted": the verification chain is
    // never entered; not "partial": `rewritten` and the blank guard are
    // structurally off), and the mapped slice is byte-identical to the exact —
    // together these entail the `newRange: mapped` fast path by the code's own
    // structure, with `verifiedSurvivor` unreachable for this anchor…
    const mapper = computeOffsetMapper(oldBody, newBody);
    const oldRange = resolveAnchor(oldBody, input["anc_b"] ?? { exact: "" });
    expect(oldRange).not.toBeNull();
    expect(mapper.classify(oldRange ?? { start: 0, end: 0 })).toBe("equal");
    const mapped = {
      start: mapper.mapStart(oldRange?.start ?? 0),
      end: mapper.mapEnd(oldRange?.end ?? 0),
    };
    expect(newBody.slice(mapped.start, mapped.end)).toBe(B);
    // …while the verification chain's verdict on the same selector is
    // "orphan": with two occurrences and the old context surviving nowhere,
    // exact-tier resolution refuses to pick. A remap in the full engine can
    // therefore only come from the fast path having fired.
    expect(resolveAnchorExact(newBody, input["anc_b"] ?? { exact: "" })).toBeNull();
  });

  it("evaluator's 4-step reproduction: a survivor duplicated by the edit stays remapped to the mapper's choice — never orphaned, context refreshed (SERVER-013-eval escalation, blessed)", () => {
    const { anchors, report } = reconcileAnchors(oldBody, newBody, input);
    // Blessed policy — an orphan-on-ambiguity engine fails here:
    expect(report).toEqual({ unchanged: [], remapped: ["anc_b"], orphaned: [] });
    const emitted = anchors["anc_b"];
    // The quote is untouched; the context is refreshed from the new
    // surroundings (a rewritten suffix on a REMAP is required behavior, not a
    // violated byte-preservation promise — that promise is for orphans).
    expect(emitted?.exact).toBe(B);
    expect(emitted?.suffix).not.toBe(input["anc_b"]?.suffix);
    // The thread lands exactly where the diff's positional alignment put it —
    // the mapper's causal choice, not an arbitrary pick among duplicates…
    const mapper = computeOffsetMapper(oldBody, newBody);
    const oldRange = resolveAnchor(oldBody, input["anc_b"] ?? { exact: "" });
    const range = resolveAnchor(newBody, emitted ?? { exact: "" });
    expect(range?.start).toBe(mapper.mapStart(oldRange?.start ?? 0));
    expect(newBody.slice(range?.start, range?.end)).toBe(B);
    // …and the emitted selector round-trips unambiguously despite the
    // duplicate (rung 1: refreshed context disambiguates the occurrences).
    expect(range?.end).toBe((range?.start ?? 0) + B.length);
  });
});

describe("reconcileAnchors — whitespace-only exact: the blank-slice guard is classification-gated (SERVER-014 rider, SERVER-022 finding 4)", () => {
  // `TextQuoteSelectorSchema.exact` requires only `min(1)`, so an anchor whose
  // exact is pure whitespace is schema-valid. For such an anchor a CORRECTLY
  // resolved match necessarily trims to nothing, so an ungated blank-slice
  // guard fires on every save — orphaning the anchor even when the edit never
  // came near it. The guard is therefore gated on the `partial`
  // classification: blank-on-`equal` is the anchor's own text untouched.
  const WS = "   ";
  const wsBody = `# Alignment\n\nalpha${WS}beta sits in the first paragraph.\n\nMiddle prose paragraph that nobody is editing today.\n\nTail paragraph carrying words that the save below rewrites.\n`;
  const wsInput = (): AnchorsMap => ({ anc_ws: capture(wsBody, WS) });

  it("a save that never touched the whitespace anchor leaves it attached, selector byte-identical", () => {
    const newBody = wsBody.replace(
      "Tail paragraph carrying words that the save below rewrites.",
      "Tail paragraph now carrying entirely different words after an unrelated save.",
    );
    const input = wsInput();
    const { anchors, report } = reconcileAnchors(wsBody, newBody, input);
    expect(report).toEqual({ unchanged: ["anc_ws"], remapped: [], orphaned: [] });
    expect(anchors["anc_ws"]).toEqual(input["anc_ws"]);
  });

  it("an edit inside the context window keeps the whitespace anchor attached — remapped, exact preserved", () => {
    const newBody = wsBody.replace("beta sits in", "beta now sits in");
    const { anchors, report } = reconcileAnchors(wsBody, newBody, wsInput());
    expect(report).toEqual({ unchanged: [], remapped: ["anc_ws"], orphaned: [] });
    expect(anchors["anc_ws"]?.exact).toBe(WS);
    expect(anchors["anc_ws"]?.suffix.startsWith("beta now sits")).toBe(true);
  });

  it("deleting the whitespace anchor's own text still orphans it, selector preserved (deleted classification)", () => {
    const newBody = wsBody.replace(`alpha${WS}beta`, "alphabeta");
    const input = wsInput();
    const { anchors, report } = reconcileAnchors(wsBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_ws"] });
    expect(anchors["anc_ws"]).toEqual(input["anc_ws"]);
  });

  it("the blank-slice guard still fires on partial: whitespace edited down goes through verification and orphans", () => {
    // 3 spaces -> 1 space: one character survives (partial), the mapped slice
    // trims to nothing, and no verbatim occurrence of the exact survives —
    // the guard routes through the verification chain, which orphans.
    const newBody = wsBody.replace(`alpha${WS}beta`, "alpha beta");
    const input = wsInput();
    const { anchors, report } = reconcileAnchors(wsBody, newBody, input);
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_ws"] });
    expect(anchors["anc_ws"]).toEqual(input["anc_ws"]);
  });
});

describe("reconcileAnchors — bounded work", () => {
  /**
   * An **order-of-magnitude** guard, not a benchmark. What it exists to catch is
   * a complexity regression — a reconcile that goes quadratic in body size or
   * anchor count blows past this by orders of magnitude, whatever the machine.
   * What it must not do is fail because the machine was busy: this suite runs
   * alongside every other workspace's, and often alongside several agents'.
   * A tight bound here has flaked repeatedly while measuring nothing about the
   * code. The measured time on an idle machine is tens of milliseconds, so five
   * seconds is ~100× headroom and still two orders of magnitude below what a
   * genuine regression costs. The vitest timeout is raised past the assertion so
   * an overrun is reported as a slow reconcile rather than as a killed test.
   */
  const RECONCILE_BUDGET_MS = 5000;

  it(
    "reconciles 50 anchors over a ~1 MB body without going superlinear",
    () => {
      const paragraphs: string[] = [];
      for (let i = 0; paragraphs.join("\n\n").length < 1_000_000; i++) {
        paragraphs.push(
          `Paragraph ${i}: filler prose about lenders, rates, and scenarios, stretched with enough words to make each block meaningfully sized for the benchmark.`,
        );
      }
      const oldBody = paragraphs.join("\n\n");
      const anchors: AnchorsMap = {};
      const step = Math.floor(paragraphs.length / 50);
      for (let a = 0; a < 50; a++) {
        const needle = `Paragraph ${a * step}: filler prose about lenders`;
        anchors[`anc_${String(a).padStart(3, "0")}`] = capture(oldBody, needle);
      }
      const middle = oldBody.indexOf(`Paragraph ${25 * step}:`);
      const newBody = `${oldBody.slice(0, middle)}An inserted paragraph right in the middle.\n\n${oldBody.slice(middle)}`;
      const startedAt = performance.now();
      const { report } = reconcileAnchors(oldBody, newBody, anchors);
      const elapsedMs = performance.now() - startedAt;
      expect(report.orphaned).toEqual([]);
      expect(elapsedMs).toBeLessThan(RECONCILE_BUDGET_MS);
    },
    RECONCILE_BUDGET_MS * 4,
  );
});
