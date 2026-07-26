import { describe, expect, it } from "vitest";
import { resolveAnchor } from "./anchors/index.js";
import type { AnchorResolver } from "./core/index.js";
import { CHECK_CODES, checkCorpus, toCheckDocument } from "./core/index.js";

/**
 * Sprint-001 TEST-62 — the corpus checker (SERVER-001) composed with the real
 * anchor engine (SERVER-002).
 *
 * The two modules are deliberately decoupled: the checker never imports the
 * engine, it takes resolution as an injected option. That decoupling is only
 * worth anything if the published signatures actually meet, so this suite
 * injects `resolveAnchor` **directly** — no adapter, no cast, no wrapper
 * lambda, no `as` — and exercises the real resolution ladder rather than a
 * substring stand-in.
 */

/** The injection point, pinned as a type-level assertion rather than a comment. */
const injected: AnchorResolver = resolveAnchor;

const PARENT_ID = "doc_a1b2c3";

/**
 * Prose whose anchored sentence is unique, so the resolvable anchor lands on
 * ladder rung 2 and the unresolvable one has nothing to grab anywhere in it.
 */
const PARENT_BODY = `We assume a 30-year fixed at 6.1% which may be stale.

Closing costs are estimated at 2% of the purchase price.
`;

/** Resolves in {@link PARENT_BODY}: a bare `exact` occurring exactly once. */
const RESOLVABLE = "assume a 30-year fixed at 6.1%";

/**
 * Well-formed but unresolvable: a non-empty `exact` with string context that
 * shares no material with the body, so every rung of the ladder declines and
 * rung 4 orphans it rather than guessing.
 */
const UNRESOLVABLE = "the seller pays the transfer tax in full at settlement";

const parent = (body: string, anchors: string): string =>
  `---
id: ${PARENT_ID}
type: note
title: Mortgage options
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:42:00Z
anchors:
${anchors}
---
${body}`;

const thread = (id: string, anchor: string): string =>
  `---
id: ${id}
type: thread
title: "Re: the assumption"
created: 2026-07-19T10:05:00Z
updated: 2026-07-19T10:07:12Z
parent: ${PARENT_ID}
anchor: ${anchor}
agent: engaged
---
## user · 2026-07-19T10:05:00Z

Is that still right?
`;

/**
 * One resolvable anchor and one well-formed-but-unresolvable anchor, each
 * claimed by a thread — so `anchor-unused` never fires and the only warning
 * left on the table is the resolution-dependent one TEST-62 is about.
 */
const corpus = (body = PARENT_BODY) => [
  toCheckDocument(
    "data/docs/finance/mortgage.md",
    parent(
      body,
      `  anc_k4f7:
    exact: ${RESOLVABLE}
  anc_m2n5:
    exact: ${UNRESOLVABLE}`,
    ),
  ),
  toCheckDocument("data/threads/th_x9y8.md", thread("th_x9y8", "anc_k4f7")),
  toCheckDocument("data/threads/th_p3q4.md", thread("th_p3q4", "anc_m2n5")),
];

describe("checkCorpus composed with the real anchor engine", () => {
  it("accepts `resolveAnchor` on its published signature", () => {
    // Property shorthand: the engine's export is handed over under the option's
    // own name, which is only possible because the shapes already agree.
    const report = checkCorpus(corpus(), { resolveAnchor });
    expect(report.errors).toEqual([]);
    expect(injected).toBe(resolveAnchor);
  });

  it("warns exactly once — for the unresolvable anchor — and reports no errors", () => {
    const report = checkCorpus(corpus(), { resolveAnchor });

    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({
      code: CHECK_CODES.anchorUnresolved,
      severity: "warning",
      docId: PARENT_ID,
      path: "data/docs/finance/mortgage.md",
    });
    expect(report.warnings[0]?.detail).toContain("anc_m2n5");
  });

  it("produces no finding for the resolvable anchor", () => {
    const report = checkCorpus(corpus(), { resolveAnchor });

    expect(report.warnings.some((warning) => warning.detail.includes("anc_k4f7"))).toBe(false);
    // …because the engine genuinely resolves it, not because it was skipped.
    expect(resolveAnchor(PARENT_BODY, { exact: RESOLVABLE })).toEqual({
      start: PARENT_BODY.indexOf(RESOLVABLE),
      end: PARENT_BODY.indexOf(RESOLVABLE) + RESOLVABLE.length,
    });
  });

  it("attributes the warning to the injected engine, not to the checker", () => {
    // Same corpus, no resolver: the checker cannot know an anchor is detached,
    // so the warning disappears entirely. Its presence above is the engine's.
    const report = checkCorpus(corpus());

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("routes through the real resolution ladder, not a substring match", () => {
    // The anchored sentence has been edited (6.1% → 6.4%), so `indexOf` fails
    // outright. Only rung 3 — bounded fuzzy — can still place this anchor; a
    // stub resolver would orphan it and the corpus would warn.
    const edited = PARENT_BODY.replace("6.1%", "6.4%");
    const report = checkCorpus(
      [
        toCheckDocument(
          "data/docs/finance/mortgage.md",
          parent(
            edited,
            `  anc_k4f7:
    exact: We assume a 30-year fixed at 6.1% which may be stale.`,
          ),
        ),
        toCheckDocument("data/threads/th_x9y8.md", thread("th_x9y8", "anc_k4f7")),
      ],
      { resolveAnchor },
    );

    expect(edited).not.toContain("6.1%");
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
