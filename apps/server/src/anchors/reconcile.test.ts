import { describe, expect, it } from "vitest";
import { TextQuoteSelectorSchema } from "@corpus/contract";
import { isWellFormedText } from "./code-points.js";
import { computeContext } from "./context.js";
import { reconcileAnchors } from "./reconcile.js";
import { resolveAnchor } from "./resolve.js";
import type { AnchorsMap, TextQuoteSelector } from "./types.js";

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
        // exact were taken verbatim from it.
        expect(resolveAnchor(newBody, selector ?? { exact: "" })).not.toBeNull();
      }
      for (const id of report.orphaned) {
        expect(next[id]).toEqual(normalized[id]);
      }
      expect([...report.unchanged, ...report.remapped, ...report.orphaned].sort()).toEqual(
        Object.keys(anchors).sort(),
      );
    }
  });
});

describe("reconcileAnchors — bounded work", () => {
  it("reconciles 50 anchors over a ~1 MB body in under a second", () => {
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
    expect(elapsedMs).toBeLessThan(1000);
  });
});
