# [SERVER-013] Anchor engine: substitution class — anchors handed unrelated text while their own text survives

## Domain

server

## Status

in_progress

## Priority

P1

## Model

fable — the discriminator design sits on the SERVER-002 in-place-edit adjudication and four evaluation rounds of recorded evidence; this is judgment work, not mechanics.

## Dependencies

- Depends on: SERVER-012
- Blocks: SERVER-005 (the write path must not consume the engine with this class open — user decision, 2026-07-26)

## Spec References

- SPEC.md §6 — anchors follow their text; orphan = no longer resolves; orphaned selectors preserved for history
- `.claude/agents/server-dev.md` → Domain Knowledge — all four anchor adjudications, including the round-3 revert record
- `issues/evals/SERVER-012-eval.md` — rounds 3 (corrected) and 4: the substitution predicate, the A/B tables, the failed similarity design, and the proposed survivor-location discriminator
- `issues/server/012-partial-path-truncated-selectors.md` — full fix-loop history incl. the round-3 revert

## Summary

Carved out of SERVER-012 by user decision (2026-07-26) after the 3-round cap: the pre-existing **substitution class** remains open. In reorder-heavy edits of wholly-distinct documents, a `partial`-classified anchor can be handed a rewritten slice of **unrelated text while its own `exact` survives verbatim elsewhere** — a thread about one paragraph silently points at another (evaluator round 4: 196/3006 anchors post-round-2, all with unique survivors; plus TEST-67(c)'s inserted-filler variants). SERVER-012's shipped rounds 1–2 (slice truncation, cross-anchor capture/collision) are done and must not regress; its round-3 similarity-threshold attempt is **reverted and off the table** — evaluation proved no similarity constant satisfies both TEST-61 (substitution → 0) and TEST-63 (shrink-with-duplicate stays remapped).

## Acceptance Criteria

- [ ] **Substitution → 0** under the evaluator's round-4 predicate (anchor handed text unrelated to its original while the original survives verbatim), over an independent-shape generator sweep including swap/rotate/reverse/shuffle of wholly-distinct paragraphs — the evaluator's generator design, not the repo sweep alone.
- [ ] **TEST-67(c) passes under the corrected predicate** (where the original survives, the anchor resolves to *that* range), both fixture variants.
- [ ] **TEST-63 with duplicates stays remapped**: a legitimate in-place shrink/edit whose original has a verbatim duplicate elsewhere is never orphaned and never re-attached to the duplicate (round 3's 67.3% regression is the anti-goal; its fixture set is in the eval file).
- [ ] **Every SERVER-012 round-2 outcome A/B byte-identical** outside the substitution class: capture/collision stay 0, straddled cases, doppelgänger scenarios (SERVER-002 round 3), cut-and-paste re-attachment, escalating-context sequence, nested-anchor exemption, musical chairs, genuine-deletion-during-reorder orphans, M1 disk matrix.
- [ ] Determinism, purity, input immutability, perf order of magnitude — the engine's standing bars.
- [ ] The chosen discriminator is **causal, not statistical**: no new similarity thresholds. If the design corner below cannot be closed without one, **stop and escalate with the case** rather than shipping a threshold.

## Technical Design

### The authorized design (user-approved scope: refines the SERVER-002 in-place-edit adjudication)

Primary discriminator, from the evaluation record: **does the anchor's own `exact` survive verbatim at a location the mapper didn't choose, and does that survivor overlap text this edit inserted?**

- Survivor overlaps **INSERT** text → the paragraph was relocated (monotonicity: an EQUAL survivor sourced from the anchor's own range is necessarily contained in the mapped slice, so a disjoint verbatim survivor in INSERT is relocation evidence). Void the rewritten slice; re-place through the existing verification chain (`resolveAnchorExact` + `touchesInsertion`, orphan last, selector byte-preserved) — which re-attaches it to the survivor.
- Survivor wholly in **EQUAL** text → it is a pre-existing duplicate, not survival of this anchor's text. The mapper's slice stays trusted (this is exactly TEST-63's shrink-with-duplicate, and the SERVER-002 adjudication surviving).

### The open corner (decide or escalate, do not threshold)

EQUAL-text survivor **plus** a wholly-unrelated rewritten slice (the round-3 chain-verify doppelgänger-under-rewrite case): trusting the mapper preserves TEST-63 but leaves a rare substitution; orphaning needs an unrelatedness signal, which is the similarity trap again. Look for a causal signal (e.g. does *any* character of the anchor's old range survive into the mapped slice per the segment table — zero-survivor slices are pure replacement, not edit); if none is principled, escalate with the concrete case and rate rather than shipping a threshold.

### Files to Create/Modify

- `apps/server/src/anchors/reconcile.ts` (and `diff.ts` if the survivor-location probe needs a mapper seam)
- `apps/server/src/anchors/reconcile.test.ts`, `reconcile.disk.test.ts` — the evaluator's fixtures as named regression tests; the substitution predicate already lives in all four sweeps
- `issues/server/012-partial-path-truncated-selectors.md` — cross-reference note only

### Edge Cases

- Survivor occurs multiple times (non-unique): re-attachment must go through the chain's uniqueness rules; ambiguity orphans.
- Both the mapped location and an INSERT location hold verbatim copies (true duplication during reorder): mapper's choice stands (no evidence it's wrong).
- 1 MB / 50-anchor and 200-scattered-edit budgets hold.

## Testing Strategy

Reproduce the evaluator's round-4 fixtures first (hiring/cash swap; TEST-67(c) variants) and log pre-fix. A/B every must-hold against the shipped round-2 engine. Extend nothing statistically: every new test asserts a causal outcome.

## E2E Verification Plan

### Verification Steps

1. Pre-fix reproduction on disk (git-diff-observed selector flip) — logged before code changes.
2. Post-fix: same fixtures re-attach to their own text; TEST-63-with-duplicate suite green; sweeps report substitution 0 with capture/collision still 0.
3. On-disk M1 matrix and doppelgänger scenarios byte-identical to round-2 outcomes.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

Implemented on: **fable**. All reproduction evidence below was produced against the **shipped
round-2 engine** (worktree base `f965936`, snapshot copied to scratch before any code change).
Scratch prefix: `/tmp/corpus-s013-nrqLcz` (sprint-004 Verification Environment). No server
bound, no port used.

**TEST-57 — on-disk reproduction (pre-fix), real `git init` workspace.**
Workspace `/tmp/corpus-s013-nrqLcz/repro-ws`: `data/docs/ops/q3-review.md` with six
wholly-distinct paragraphs, one anchor (`anc_hire`) on the hiring paragraph (#4), committed;
then paragraphs #4 and #6 swapped **on disk** (body only, outside-editor style); then
reconciliation run with the pre-fix engine and the frontmatter written back. `git diff -U2`
observed:

```
-    exact: "Hiring velocity stalled around the hiring committee's bar, before the budget review lands."
+    exact: "Cash runway stalled around nineteen months of burn, assuming no new debt this year."
     prefix: "ckets, per the operating plan.\n\n"
     suffix: "\n\nMarketing spend shifted toward"
```

Report: `{"unchanged":[],"remapped":["anc_hire"],"orphaned":[]}` — the anchor is handed
**another paragraph's text** (cash runway) while its own text survives verbatim, uniquely, in
the new body (the swapped-to position; `newBody.indexOf(own) = 446`, occurrence count 1).
The round-4 hand-verified minimal fixture (two near-identical paragraphs swapped, one anchor
on P1) also reproduces at library level: emitted `exact` = P2's text
(`"Paragraph two now has margin and cherries in the budget quarter."`) while P1's text
survives uniquely at offset 74.

**TEST-58 — measured pre-fix baseline (not assumed).**
Independent-shape generator (evaluator round-4 design): 6 shapes (swap-adjacent,
swap-distant, rotate, reverse, shuffle, swap-with-edit) × 2 families (wholly-distinct /
near-identical paragraphs), 4–7 paragraphs per doc, 2–4 anchors, ~30% sub-spans,
deterministic `mulberry32` PRNG. Predicate is **provenance-causal, no similarity anywhere**:
anchor remapped to text not related to its own source paragraph's post-edit text while its
original `exact` survives verbatim at a location disjoint from where it landed.

`seed=20260726 docs=1200 anchors=3599` — shipped engine:

| family/shape                  | anchors | substitution | falseOrphan |
| ----------------------------- | ------- | ------------ | ----------- |
| distinct/reverse              | 304     | 3            | 0           |
| distinct/rotate               | 292     | 0            | 0           |
| distinct/shuffle              | 287     | 13           | 0           |
| distinct/swap-adjacent        | 294     | 2            | 0           |
| distinct/swap-distant         | 300     | 35           | 0           |
| distinct/swap-with-edit       | 304     | 29           | 0           |
| near-identical/reverse        | 301     | 69           | 29          |
| near-identical/rotate         | 313     | 0            | 0           |
| near-identical/shuffle        | 299     | 61           | 11          |
| near-identical/swap-adjacent  | 292     | 31           | 11          |
| near-identical/swap-distant   | 300     | 28           | 11          |
| near-identical/swap-with-edit | 313     | 48           | 11          |

**Baseline: 319 / 3599 anchors (8.9%) are substitutions on the shipped engine** (73/3599
unique-survivor orphans, pre-existing). Both families reproduce, including wholly-distinct
swaps — the hiring/cash class.

### Post-Implementation Verification

**The change** (all in `apps/server/src/anchors/reconcile.ts`; no `diff.ts` seam needed —
`touchesInsertion` already exists):

1. **Relocation evidence** (the authorized discriminator) joins the dishonest-slice filter in
   the honesty pass: a rewritten slice is voided when any verbatim occurrence of the anchor's
   `exact` sits **disjoint** from the slice **and overlaps INSERT text**. The scan
   deliberately ignores uniqueness — it only voids; re-placement still runs the adjudicated
   chain (`resolveAnchorExact` + `touchesInsertion`, orphan last, selector byte-preserved),
   whose uniqueness rules orphan on genuine ambiguity rather than pick an occurrence
   (TEST-64). EQUAL-text survivors never void (TEST-63's shrink-with-duplicate — the
   SERVER-002 adjudication holding).
2. **Boundary repair** (TEST-67c/TEST-60): a rewritten `partial` slice snaps to a verbatim
   occurrence of its own `exact` that **overlaps the mapped range** and round-trips — the
   mapper followed the text but its endpoints sat alignment-noise characters off (shipped
   round-2 emitted the moved sentence minus its trailing period). Exact-tier, location-based.

No similarity value is computed on either path; no numeric constant was added (TEST-68 —
the diff introduces only `indexOf` scans and range-overlap tests).

**TEST-59 — substitution → 0.** Same generator, same seed, post-fix:
`seed=20260726 docs=1200 anchors=3599` → **substitution 0/3599 across every shape × family**
(baseline 319; under the round-4 strict predicate — survivor unique, "zero ambiguity about
the right answer" — baseline 309 → 0). Second seed `424242`, `1200 docs / 3571 anchors`:
309 → **0**. Unique-survivor false orphans *improved* as a side effect: 73 → 56 (seed 1) and
80 → 68 (seed 2) — relocation evidence re-attaches unique survivors the shipped engine
orphaned. Residuals, decomposed and out-of-class:
- `ambiguous` 5/3599 (identical on both engines): sub-span anchors byte-identical across
  every sibling paragraph (the sub-span excludes the distinguishing word) — multi-copy
  musical chairs; the emitted slice is the same phrase with this edit's insertion applied,
  and no causally right answer exists. Mapper's positional choice stands, per the
  musical-chairs adjudication.
- `unrelated-no-survivor` 9+7 (identical on both engines): the anchored paragraph was both
  relocated **and** edited in one write, so its original survives nowhere verbatim — outside
  the round-4 class by definition (it requires verbatim survival); only fuzzy could find the
  edited relocated copy, and fuzzy is off the table.

**TEST-60 — 67c both variants.** Both the one- and two-paragraph-insert fixtures resolve to
the range holding their own moved text (`range.start === newBody.indexOf(SENT)`, full
trailing period included). The shipped engine emitted the moved sentence truncated by its
final `.` on the two-insert variant — the sanctioned flip.

**TEST-61 — shrink-with-duplicate, 600 docs** (150 × shrink / heavy / medium /
boundary-crossing-delete, each with a verbatim duplicate in an appendix, seeded
`mulberry32(9137)`): **failures 0, orphans 0, every anchor remapped onto the in-place edited
text, never the duplicate — and 0 A/B flips vs the shipped engine** (byte-identical; round 3
orphaned 404/600 here).

**TEST-62/63/64/65** — named repo tests added in `reconcile.test.ts` (relocation re-attach;
EQUAL-survivor mapper-trust incl. the 68c-style must-not-fix rewrite; ambiguous-survivor
orphan with selector byte-preserved; true-duplication mapper-stands) plus musical chairs,
nested-exemption-reordered, 67c both variants, and a 4-permutation order-independence test.
On-disk named test added in `reconcile.disk.test.ts` (hiring/cash swap → `exact` stays own
text on disk). Anchor suite: **180 tests, 0 failures**.

**TEST-66 — must-hold A/B, byte-identical.** 42 named fixtures run through both engines,
full result JSON compared: **39/42 byte-identical** — M1 matrix (6), escalating-context
(4 + deletion + 67a/67b), deletion scenarios 66/1–4, straddle family (7 incl. doppelgänger
orphan and re-typed re-attach), legitimate shrinks (3), reorder round-2 set (reversed doc,
twin orphan, nested plain, shadow round-trip), guarantees (already-orphaned, whole-body
replace, whitespace ×3), musical chairs, reorder+genuine-deletion, 67c-one-insert. The
**only 3 flips**: the two substitution fixtures (hiring/cash: shipped emitted CASH text →
post-fix emits HIRE, context refreshed; round-4 minimal: shipped emitted P2 → post-fix P1)
and 67c-two-inserts (truncated → full exact). Sweep-level A/B: 338 flips across 3599
anchors, **0 outside the substitution class**.

**TEST-67 — standing bars.** Determinism: 200 runs → 1 distinct result. Order-independence:
4 anchor-key permutations → identical serialized output (repo test). Input immutability +
already-orphaned-never-re-attach: existing repo tests, green. Purity: grep over the anchors
module — no I/O, clock, or randomness imports. Perf vs shipped (reverse-reorder + edits,
mean of 3 after warm-up): 50 anchors 1.11×, 100 → 1.05×, 200 → 1.03×, 400 → 1.02×;
200-scattered-edits/50-anchors 1.01×; 1 MB / 50-anchor repo budget green (<1 s).

**TEST-68 — no similarity constant; corner disposition (reported, not escalated as a
blocker).** The diff contains no new numeric threshold and the discriminator reads no
similarity score. The open corner — **EQUAL-text unique survivor + wholly-unrelated
rewritten slice** — is closed as **mapper-trust by the authorized design's EQUAL rule**
(= the SERVER-002 in-place-edit adjudication), with this analysis for the record: the
issue's suggested causal signal (zero old-range characters surviving into the slice) is
**vacuous on the partial path** — `classify()` returns `partial` only when ≥ 1 character of
the old range survives, and a zero-survivor pure replacement classifies `deleted`, which
already takes the verification path where an EQUAL doppelgänger correctly orphans (66/4,
68a/b). So every slice reaching the corner shares surviving characters with the original —
causal edit evidence — and any further "unrelatedness" discrimination would be a similarity
measure. **Measured rate: 0** in both 1200-doc sweeps (no wholly-unrelated slice with an
EQUAL unique survivor occurred in any reorder family); the concrete constructed case (heavy
rewrite sharing only fragments, verbatim duplicate in the appendix) is pinned as a
must-not-flip repo test and stays `remapped` on the rewritten slice, byte-identical to the
shipped engine.

**On-disk verification (post-fix).** Fresh `git init` workspace
(`/tmp/corpus-s013-nrqLcz/repro-ws-postfix`), same seed/commit/edit/reconcile flow as the
reproduction: report `{"remapped":["anc_hire"]}` and `git diff` shows `exact:` **unchanged
on the hiring text** — only `prefix`/`suffix` refresh to the paragraph's new neighbourhood
(`prefix: ", though the data lags a week.\n\n"`, `suffix: "\n"`).

**Gates.** `npm run build` ✓ · `npm run lint` ✓ · `npm run format:check` ✓ ·
`npm run typecheck` ✓ · `npm run test:coverage`: **114 files / 2133 tests, 0 failures**;
coverage 99.22% lines / 95.9% branches / 99.63% functions (gate ≥ 90);
`reconcile.ts` 100% lines / 98.75% branches. No server bound at any point; scratch confined
to `/tmp/corpus-s013-nrqLcz`; generator sweeps reproducible from recorded seeds
(20260726, 424242, 9137, 777).

## Completion Checklist (domain agent)

- [x] Tests written and passing (anchor suite 180; full run 2133/2133)
- [x] `/lint` passes (eslint, prettier, tsc all green)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (substitution 0 on two seeds; 67c both variants; TEST-63-with-duplicate 600/600 byte-identical; must-hold A/B 39/42 identical with only sanctioned flips; standing bars held; no similarity constant — corner reported with rate 0)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-013]` prefix
