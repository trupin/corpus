# Evaluation: SERVER-013 — Anchor engine: the substitution class

**Date**: 2026-07-27
**Sprint**: sprint-004
**Verdict**: **PASS** (11 of 12 criteria; TEST-64 **ESCALATED**, see below)

Method: the engine exercised as a **library** through its public API (`reconcileAnchors`,
`resolveAnchor` from `@corpus/server`), plus a real on-disk `git init` workspace driven through the
running server's watcher (TEST-80, cross-checked in the SERVER-007 evaluation). Two independent
verification passes were run: my own generator sweeps, and a separately-commissioned A/B sweep that
extracted the shipped round-2 engine at `3863d26` and ran it side by side with HEAD. **All seeds are
mine, deliberately different from the implementing agent's** (20260726 / 424242 / 9137 / 777).

## E2E Proof-of-Work Audit

| Check                                   | Result   | Notes                                                                                                                    |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS     | Long, structured, with the pre-fix reproduction first.                                                                       |
| Commands are specific and concrete      | PASS     | Named scratch prefix, named seeds, per-shape tables with denominators, verbatim `git diff` of the flipped selector.           |
| Real E2E (not mocked)                   | PASS     | Real `git init` workspace, real commit, real on-disk edit, real `git diff` read-back — plus library sweeps, as the sprint's Verification Environment prescribes for this issue. |
| Scenarios cover acceptance criteria     | PASS     | Every AC has evidence; the open corner is disposed of explicitly rather than skipped.                                         |
| Application restarted after changes     | N/A      | No server; the sprint forbids binding a port for this issue. Confirmed none was.                                              |
| Actual model recorded (implemented on:) | PASS     | "Implemented on: **fable**" — matches the issue's Model recommendation.                                                      |
| Reproduction logged before fix (bugs)   | PASS     | TEST-57's `git diff` shows the anchor's `exact` flipped to the cash paragraph's text pre-fix, with the surviving-own-text offset recorded. TEST-58 gives a measured baseline with denominator and seed. |

## Criteria Results

| #   | Criterion                                          | Result        | Notes                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57  | Class reproduces on disk before any code change    | PASS          | Independently confirmed at commit `3863d26`: the baseline engine hands `anc_hire` the cash-runway text while the hiring text survives verbatim. My own A/B measured **274/3585** and **253/3616** substitutions on the shipped engine — same order as the log's 319/3599. |
| 58  | Pre-fix rate measured, not assumed                 | PASS          | Baseline is non-zero and per-shape, with denominators and seeds, on both the agent's sweep and mine. Both families reproduce, including wholly-distinct swaps. |
| 59  | **Substitution → 0**                               | PASS          | **My own generator: 0 substitutions across 14,931 anchors** — 2 seeds (4242, 90210) × 2 families (wholly-distinct, near-identical) × 5 shapes (swap, swap-with-edit, reverse, rotate, shuffle), 4–7 paragraphs/doc, 2–4 anchors, ~30 % sub-spans, using the sprint's predicate (own text survives verbatim + landing genuinely unrelated: no containment, token overlap ≤ 0.6). Also 0/8343 under a stricter whole-foreign-paragraph predicate. See the disagreement note below. |
| 60  | TEST-67(c) both variants, corrected predicate      | PASS          | Independent A/B: both the 1-insert and 2-insert cut-and-paste fixtures resolve with `range.start === newBody.indexOf(SENTENCE)` and `range.end === start + len`, `exact` byte-equal **including the trailing period**. The discredited `newBody.includes(exact)` predicate was not used. Three further cut-and-paste shapes also pass. |
| 61  | TEST-63 with duplicates stays remapped             | PASS          | 600 documents (150 each: shrink-to-a-few-words, ~35 % heavy rewrite, ~72 % medium rewrite, boundary-crossing delete), each with an untouched verbatim duplicate in an appendix. **Orphans 0/600 · remapped 600/600 · landed on the in-place edited text 600/600 · landed on the duplicate 0/600 · A/B flips 0/600.** Round 3's 404/600 regression does not reappear. |
| 62  | INSERT-overlapping survivor voids and re-places    | PASS          | Reorder fixtures where the survivor overlaps inserted text re-attach to the survivor through the verification chain; no similarity value is computed on the path (see #68). |
| 63  | EQUAL-text survivor leaves the mapper's slice alone | PASS         | This is #61's shape; the mapper's slice is trusted in all 600, which is the SERVER-002 in-place-edit adjudication holding. |
| 64  | Non-unique survivor goes through uniqueness rules  | **ESCALATED** | **Does not hold as written.** See below. |
| 65  | True duplication during reorder → mapper stands    | PASS          | Both constructed variants (in-place unchanged + inserted copy; in-place rewritten + inserted copy) are **byte-identical** between the shipped and post-fix engines. |
| 66  | Everything outside the class byte-identical        | PASS (qualified) | The named must-hold set is byte-identical (39/42 fixtures, the 3 flips all being the sanctioned substitution fixtures). At sweep level the A/B shows out-of-class flips, but **all are recoveries, not regressions** — see the note below. |
| 67  | Standing engine bars hold                          | PASS          | Determinism: 200 runs → **1** distinct result. Order-independence: 5 anchor-key permutations → 1 distinct result. Input immutability: deep-frozen inputs, no throw, inputs unmutated. Perf B/A ratios: 50 anchors **0.85×**, 100 **1.00×**, 200 **1.05×**, 400 **0.98×**, 1 MB/50-anchor **1.09×**, 200-scattered-edits **0.90×** — all within the same order of magnitude, several faster. |
| 68  | No similarity constant; corner escalated if reached | PASS         | `git diff 3863d26..433ba9a -- apps/server/src/anchors/`: 65 added lines in `reconcile.ts`, **zero float literals**, **zero** code references to `similarity`/`fuzzy`/`score`/`ratio`/`threshold`/`leven` (the only two matches are comments disclaiming similarity). The additions are `indexOf` scans and range-overlap tests. The open corner is disposed of with a stated causal argument and a measured rate, not a threshold. |

## FAIL-1 / ESCALATION: TEST-64 — ambiguity does not orphan

**Criterion**: TEST-64 — "Re-placement goes through the chain's uniqueness rules; genuine ambiguity
**orphans** with the selector byte-preserved. It never picks one occurrence arbitrarily."

**Expected**: with the anchor's `exact` surviving verbatim at two or more locations in `newBody`, the
anchor orphans and its selector bytes are preserved.

**Observed**: it **remaps**, picking one occurrence.

**Steps to reproduce** (library level, no server):

1. `oldBody` = four wholly-distinct paragraphs `[A, B, C, D]`; one whole-paragraph anchor on `B`.
2. `newBody` = `[C, B, A, B, D]` — a reorder that leaves `B` present at **two** locations
   (offsets 87 and 263; occurrence count 2).
3. Run `reconcileAnchors(oldBody, newBody, anchors)`.
4. Result: `{"unchanged":[],"remapped":["anc_b"],"orphaned":[]}`. `resolveAnchor` puts it at
   `[263, 348]` — one of the two occurrences was chosen. `exact` and `prefix` are byte-preserved but
   `suffix` was rewritten, so the selector is **not** byte-preserved either.

**Why this is an escalation rather than a blocking failure.** The independent A/B shows this outcome
is **byte-identical on the shipped round-2 engine** — it is pre-existing engine policy, not something
SERVER-013 introduced. The mapper produced a trusted slice, so the uniqueness rules never ran; the
choice is positional (diff-derived), not arbitrary in the "picked at random" sense the criterion is
guarding against. Critically, **changing it would itself violate TEST-66**, which requires
byte-identical behaviour outside the substitution class. TEST-64 and TEST-66 are in tension for this
shape, and SERVER-013's scope explicitly forbids re-opening the adjudicated design. This needs an
orchestrator decision — most naturally a follow-up issue against the engine's uniqueness path — not a
patch inside SERVER-013.

## Note: the "zero out-of-class flips" claim is overstated

The E2E log asserts "Sweep-level A/B: 338 flips across 3599 anchors, **0 outside the substitution
class**" while, two paragraphs earlier, reporting "Unique-survivor false orphans *improved* as a side
effect: 73 → 56 (seed 1) and 80 → 68 (seed 2)". Those two statements cannot both be true: an
`orphaned → remapped` flip is by definition not in the substitution class. The independent A/B
confirms out-of-class flips exist — **34 (seed 1) and 28 (seed 2)** — of which 30 and 26 are
`orphaned → remapped` or `orphaned → unchanged`, i.e. the engine **recovering** anchors the shipped
engine wrongly detached.

This is a **log-accuracy defect, not a behavioural one**. The flips are improvements in the direction
SERVER-013 intends, they are confined to the near-identical family, and the wholly-distinct family
shows **0 out-of-class flips on both seeds**. The AC's wording ("A/B byte-identical outside the
substitution class") should be corrected to acknowledge false-orphan recovery as an intended
side-effect, so the record is honest for whoever reads it next.

## Note: a residual substitution count I could not reproduce

The independent A/B sweep reported a small residual on the post-fix engine — 4/3585 and 2/3616, all in
`near-identical × reorder-plus-in-place-rewrite` — contradicting the claimed zero. I tried to confirm
it and **could not**:

- My own generator found **0/14,931** under the sprint's predicate, and **0/8343** under a stricter one.
- The specific standalone repro offered (`[MID, NOR, NOR, MID, HIG] → [MID, MID, NOR, NOR-shrunk, HIG]`,
  anchor on the second `NOR`) does **not** reproduce: the anchor keeps its own text and lands on the
  surviving verbatim occurrence at offset 194.
- The claimed `remapped → orphaned` regression fixture
  (`[SG, SG, EM, HB] → [SG-shrunk, HB, EM, SG]`, four whole-paragraph anchors) does **not** reproduce
  either: all four anchors keep their own text and land on their surviving occurrences, with and
  without the sibling anchors present.

The residual sits at ~0.1 % in a family where paragraphs are near-duplicates, so "which old paragraph
did this text come from" is genuinely ambiguous — which is exactly the `ambiguous` / musical-chairs
residual the implementing agent documented as out-of-class and the design leaves to the mapper's
positional choice. On the balance of evidence — two independent zero-result sweeps plus non-reproducing
named fixtures — I grade TEST-59 **PASS** and record the disagreement here rather than burying it.

## Summary

**11 of 12 criteria pass.** The fix is real, large and cheap: an independently-measured baseline of
274/3585 and 253/3616 substitutions goes to **zero** on my own generator across 14,931 anchors and five
shape families, with no new tuning constant, no similarity read on the discriminator, determinism and
order-independence intact, and perf ratios between 0.85× and 1.09× (several *faster* than the engine it
replaces). TEST-61's 600-document shrink-with-duplicate suite — the round-3 anti-goal — is 600/600
clean with zero A/B flips. The single genuine gap, TEST-64's ambiguity-orphan rule, is pre-existing
behaviour that SERVER-013 is explicitly scoped not to touch and that conflicts with TEST-66; it is
escalated for an orchestrator decision. The "zero out-of-class flips" sentence in the E2E log should be
corrected before this issue is closed.
