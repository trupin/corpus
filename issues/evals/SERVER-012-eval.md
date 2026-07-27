# Evaluation: SERVER-012

**Date**: 2026-07-26
**Sprint**: sprint-002
**Round**: 4 (confirming pass on the round-3 fix, commit `4515fb9`)
**Verdict**: **FAIL** — 10 of 12 acceptance tests pass.
**TEST-63 fails on a NEW regression introduced by round 3**, and **TEST-61 still fails** on
a residual that is 6.5 %, not "~0".

Round 3 does what it set out to do: **every hard check I built in round 3 is now zero.**
The substitution class I measured at 378 is gone, my hand-verified hiring/cash fixture is
correct, and TEST-67(c) — which I failed in round 3 — now passes on both variants. That is
real progress and it is not in dispute.

But `lacksKinship` uses similarity as a proxy for "is this an edit of my text", and that
proxy is wrong in **both** directions:

- **False positive → new regression.** A legitimate *shrink* or heavy in-place rewrite is
  below `FUZZY_THRESHOLD`, so whenever a verbatim copy of the original exists anywhere else
  in the document the anchor is voided and **orphans**. Round-2 and pre-round-2 both remapped
  it correctly. **404 / 600 (67.3 %)** of such documents. This is TEST-63's named failure
  mode and it re-opens an adjudication the sprint declares out of scope.
- **False negative → residual persists.** A *different* near-identical sibling paragraph sits
  at ~0.94 similarity, above threshold, so it is trusted as an in-place edit. **196 / 3006
  anchors (6.5 %)** attach to another paragraph while their own text survives **uniquely**
  elsewhere.

Environment: black-box library probes plus real `git init` disk fixtures; 3-way A/B against
`46fa225` (round 2) and `a776387` (pre-round 2), both reconstructed read-only via `git show`.
Scratch `/tmp/eval-p2-scratch/r4-*`. Repo tree clean; HEAD `4515fb9`; `FUZZY_THRESHOLD = 0.75`.

---

## What round 3 fixed — confirmed, with my own generator

3-way sweep, 1000 cases / 3006 anchors, 7 shapes (4 reorder families), 50 % near-identical /
50 % wholly-distinct, 2–4 anchors, 30 % sub-spans:

| check                                                       | **HEAD `4515fb9`** | round-2 `46fa225` | pre-round-2 `a776387` |
| ----------------------------------------------------------- | ------------------ | ----------------- | --------------------- |
| **A** `slice !== exact` / orphan not preserved               | **0**              | 0                 | 0                     |
| **B** capture (co-anchor's exact)                            | **0**              | 0                 | 199                   |
| **C** collision (new overlap)                                | **0**              | 0                 | 140                   |
| **D** superset (grew > 1.2×)                                 | **0**              | 2                 | 32                    |
| **E** substitution below threshold (sim < 0.75)              | **0**              | 29                | 97                    |

Round-3 FAIL-1 (hiring/cash, 6 distinct paragraphs, swap #4↔#6, one anchor): HEAD now
`remapped` **to its own text**; round-2 emitted `"Cash runway extends nineteen months…"`.
Round-3 FAIL-2 (TEST-67c, both the 1- and 2-paragraph-insert variants): both now resolve to
their own moved text. TEST-67 rows (a) and (b) unchanged and correct.

Doppelgänger set — the refinement flipped **nothing**: 68a orphan-preserved, 68b
orphan-preserved, 68c (must-not-fix) still `remapped` to its own text, 66/1–4 all
orphan-preserved. Round-1 fixtures 59/60 and 64 unchanged. 69/4 (TEST-26) `remapped`.
Nested anchors correct plain and reordered. Musical chairs: two anchors on byte-identical
paragraphs → distinct ranges `{67}` / `{192}`, order-preserving. Reorder + genuine deletion:
P2 orphans preserved while P1/P4 re-attach to their own text. Round-2's FAIL-1 fixture stays
fixed. Determinism 200 runs → 1 result. Order-independence across 4 key/id permutations →
identical. Purity grep → zero hits. Perf ratio vs round-2: 1.45 / 1.19 / 1.14 / 1.07 at
50 / 100 / 200 / 400 anchors — flat-to-improving, no blow-up.

**Gates:** build ✓ · lint ✓ · typecheck ✓ · **1693 tests / 85 files, 0 failures** ·
coverage 99.56 / 96.28 / 100.

## Criteria Results

| #   | Criterion                                             | Result   | Notes                                                                                                                                        |
| --- | ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 59  | The bug reproduces on disk before any fix             | PASS     | Verified in round 1 character for character.                                                                                                   |
| 60  | The reproduced scenario is clean after the fix        | PASS     | Both anchors orphan with byte-preserved selectors; frontmatter untouched.                                                                       |
| 61  | Selector integrity is a general invariant             | **FAIL** | A/B/C/D/E all 0. But 196 / 3006 (6.5 %) attach to **another paragraph's text** while their own survives uniquely — TEST-61's third clause. See FAIL-1. |
| 62  | The failure path falls through the adjudicated ladder | PASS     | Fuzzy bait rejected; voided slices take exact-only + insertion-overlap, orphan last.                                                            |
| 63  | Legitimate shrinking edits still remap                | **FAIL** | **Regression.** A genuine shrink orphans whenever a verbatim duplicate of the original exists elsewhere — 404 / 600 (67.3 %). See FAIL-2.       |
| 64  | Both siblings deleted → both orphan                   | PASS     | Both orphaned, selectors preserved.                                                                                                            |
| 65  | The M1 disk matrix stays green                        | PASS     | Anchor suite 8 files / **173 tests**, 0 failures.                                                                                              |
| 66  | The four deletion scenarios still orphan              | PASS     | All four orphaned, selectors byte-preserved.                                                                                                    |
| 67  | Cut-and-paste still re-attaches                       | **PASS** | **Fixed this round.** All rows including (c) resolve to their own moved text, on both fixture variants that failed in round 3.                   |
| 68  | Doppelgänger and plain deletion still orphan          | PASS     | (a)/(b) orphan-preserved; must-not-fix case still remaps. No flips.                                                                             |
| 69  | The escalating-context sequence stays all-remapped    | PASS     | Including row 4 (TEST-26).                                                                                                                     |
| 70  | Determinism, purity and perf unchanged                | PASS     | 1 distinct result ×200; order-independent; zero impure imports; perf ratio 1.07–1.45.                                                            |

## Failures

### FAIL-2 (new, and the blocking one): legitimate in-place edits orphan when a verbatim duplicate exists

**Criterion**: TEST-63 — "An anchored passage genuinely edited down to a few words … is
reported `remapped` with the shortened `exact` equal to the new range's full text. **A fix
that orphans real shrink edits fails this test.**" Also the sprint's **Out of Scope**:
"Re-opening SERVER-002's round-2/round-3 adjudications: … **in-place edit evidence outranks a
verbatim duplicate elsewhere**."

**Reproduction** — TEST-63's own scenario, with one verbatim copy of the original added to an
appendix:

```
old: "\n# Doc\n\nLead.\n\n<T>\n\nTail.\n\nAppendix: <T>\n"
new: "\n# Doc\n\nLead.\n\nWe assume 6.1%.\n\nTail.\n\nAppendix: <T>\n"
     where T = "We assume a 30-year fixed at 6.1% for the base case."

TEST-63/1 shrink to a few words, NO duplicate
  HEAD    : remapped   "We assume 6.1%."          ← correct
TEST-63/1 shrink to a few words, WITH verbatim duplicate elsewhere
  HEAD    : orphaned   <selector preserved>       ← REGRESSION
  round-2 : remapped   "We assume 6.1%."
  pre-r2  : remapped   "We assume 6.1%."
TEST-63/2 boundary-crossing delete, WITH duplicate
  HEAD    : orphaned                              ← REGRESSION
  round-2 : remapped   "We assume a 30-year fixed"
  pre-r2  : remapped   "We assume a 30-year fixed"
```

Same for heavy rewrites. A/B across all three engines:

```
heavy in-place edit (sim ~0.35) + verbatim duplicate elsewhere
  HEAD    : orphaned
  round-2 : remapped, stayed on the in-place edited text
  pre-r2  : remapped, stayed on the in-place edited text
medium in-place edit (sim ~0.72) + duplicate
  HEAD    : orphaned
  round-2 : remapped, stayed on the in-place edited text
  pre-r2  : remapped, stayed on the in-place edited text
mild in-place edit (sim ~0.96) + duplicate
  HEAD    : remapped, stayed on the in-place edited text   ← above threshold, unaffected
```

**Rate**: 600 documents in which an anchored passage is edited in place while a verbatim copy
of the original sits elsewhere — **HEAD orphans 404 (67.3 %); round-2 orphaned 0.**

**Why the repo suite does not catch it**: TEST-63's fixtures contain no duplicate of the
anchored text, so the second condition never fires. 173 anchor tests pass.

**Mechanism** (inferred behaviourally, no source read): the kinship exemption covers *the
original occurring wholly inside the slice*. The converse — **the slice being a sub-range of
the original**, which is precisely what a shrink is — is not treated as kinship, so a shrink
scores below threshold and is voided. Corpus documents repeat text routinely (quoted
passages, appendices, boilerplate, repeated table cells), so the second condition is not
exotic.

### FAIL-1 (carried, narrowed): a sibling paragraph above threshold is trusted as an in-place edit

**Criterion**: TEST-61 — "never a prefix, never a superset, **never another range's text**."

**Hand-verified minimal reproduction** — two near-identical paragraphs, swapped, **one**
anchor:

```
old: "\n# Doc\n\n<P1>\n\n<P2>\n\nA closing paragraph that stays put.\n"
new: "\n# Doc\n\n<P2>\n\n<P1>\n\nA closing paragraph that stays put.\n"

ONE anchor on P1  -> remapped, landed on {8,72} = P2's text
                     own text survives UNIQUELY at {74,138}
                     own   : "Paragraph one now has margin and cherries in the budget quarter."
                     landed: "Paragraph two now has margin and cherries in the budget quarter."
BOTH anchored     -> both resolve to their own text  (round-2's cross-anchor pass fires)
```

**Rate and decomposition** — 196 / 3006 anchors (6.5 %), **all with their own text surviving
UNIQUELY** (zero ambiguity about the right answer):

```
  98  above-threshold sibling | near-identical doc | whole-paragraph anchor | own text UNIQUE
  94  above-threshold sibling | near-identical doc | sub-span anchor        | own text UNIQUE
   4  containment-kin         | distinct-text doc  | whole-paragraph anchor | own text UNIQUE
similarity distribution: min 0.773  median 0.924  max 1.000
```

**Judging the accepted residual, as asked.** The disclosure describes it as fixture-sensitive
and near-zero, characterised as ~0.98-similarity near-threshold misalignment. **My sweeps do
not support that.** It is 6.5 % of anchors, the median similarity is 0.924 (not 0.98), and
the dominant case is not a near-threshold artifact — it is a **plain two-paragraph swap in a
document with near-identical paragraphs**, which is the exact family SERVER-012 was filed to
fix. That said, I accept the *engineering* claim: at 0.94 similarity a sibling paragraph and
a genuine in-place edit are indistinguishable to a per-anchor similarity test, and raising
the bar is what produces FAIL-2. The residual is real, it is larger than disclosed, and it is
not separable from FAIL-2 — they are the two sides of one threshold.

## Assessment

The similarity proxy is the wrong discriminator, and this round demonstrates it from both
sides at once. Lowering the threshold widens FAIL-2 (more legitimate edits orphaned); raising
it widens FAIL-1 (more sibling misattachments trusted). No setting of a single per-anchor
similarity constant satisfies both TEST-61 and TEST-63.

The evidence points at a different discriminator, which both failures share and neither uses:
**whether the anchor's own text survives verbatim and uniquely at a location the mapper did
not choose.** In every FAIL-1 case it does (196/196 unique). In the FAIL-2 shrink cases the
survivor is a *pre-existing duplicate*, which the SERVER-002 ladder already knows how to
reject via insertion-overlap. That is a design decision, not a tuning exercise, and it sits
on top of an adjudication the sprint closed — which is why this now warrants the user, not
another round.

**Recommendation: escalate.** Round 3 is a genuine improvement on round 2 (five hard checks
to zero, TEST-67 fixed) but it trades a 6.5 % misattachment for a 67 % orphan rate on
duplicate-bearing in-place edits, and TEST-63 names that trade as a failure. Shipping is
defensible only with the FAIL-2 regression accepted explicitly by the user, because unlike
everything in rounds 1–3 it is **not pre-existing** — round-2 and pre-round-2 both handle it
correctly.

## Discrepancies between the round-3 log and observation

**DISC-1 — "136 → 0 substitution" corroborated in direction, not in count.** My independent
generator measures 29 → 0 (round-2 → HEAD) on my seeds, and 97 at pre-round-2. The
elimination is confirmed; the absolute figure is generator-dependent and should not be quoted.

**DISC-2 — the accepted residual is understated.** Disclosed as fixture-sensitive, ~0,
near-threshold (~0.98). Measured: 6.5 % of anchors, median similarity 0.924, dominant case a
plain two-paragraph swap. See FAIL-1.

**DISC-3 — the chain analysis is sound but incomplete.** "EQUAL survivors from the anchor's
own range are by monotonicity contained in the slice, so disjoint verbatim survivors are
either INSERT-relocated (re-attach) or pre-existing doppelgängers (orphan)" — correct for the
cases it enumerates, and it is why FAIL-1's substitution class is gone. It does not cover the
case where the *slice is a sub-range of the original* (a shrink), which is what FAIL-2 turns on.

## Summary

**10 of 12 acceptance tests pass.** Round 3 eliminates every hard defect I measured in round
3 — capture, collision, superset and substitution all zero across 3006 anchors — and fixes
TEST-67(c), which I failed last round. It also introduces a **regression**: legitimate shrink
and heavy in-place edits now orphan whenever a verbatim copy of the original exists elsewhere
in the document (404/600, 67.3 %), which TEST-63 names as a failure and which re-opens the
in-place-edit adjudication the sprint placed out of scope. The accepted residual is 6.5 %,
not ~0. The two failures are the two sides of one similarity threshold and cannot be tuned
apart. **Escalating to the user with the full record.**

---

## Appendix — round history (kept for the audit trail)

**Round 2** (`46fa225`, cross-anchor pass). Fixed round-1's superset/overlap reproduction:
capture 199 → 0, collision 140 → 0. Round-3 evaluation initially graded this PARTIAL, then
corrected to FAIL: my capture/collision checks were *cross-anchor only* and shared the fix's
blind spot, and my must-hold A/B used `newBody.includes(sel.exact)` — a predicate any
resident text satisfies. Adding a substitution check exposed 378 violations where those
checks reported 0, and TEST-67(c) failed under the corrected predicate.

**Round 1** (`9c3ae78`, straddle guard). Fixed the truncation arm of the original
near-identical-sibling bug; the superset arm survived and produced round 2's FAIL.

**Round 3** (`4515fb9`, `lacksKinship`). Fixed the substitution class and TEST-67(c);
introduced FAIL-2. Every earlier failure was pre-existing; this one is not.
