# Evaluation: SERVER-012

**Date**: 2026-07-26
**Sprint**: sprint-002
**Round**: 3 (re-evaluation of the round-2 fix, commit `46fa225`)
**Verdict**: **FAIL** — 10 of 12 acceptance tests pass. **TEST-61 fails on its
"never another range's text" clause** (378 / 3006 anchors), and **TEST-67 fails on row (c)**.
Both failures are **pre-existing and byte-identical to pre-round-2** — round 2 is not a
regression, it is an incomplete fix for a defect larger than any round has characterized.

**Correction to my own first round-3 pass.** My initial round-3 verdict said "both
harm-bearing clauses now hold universally" and graded this PARTIAL. **That was wrong, and
the way it was wrong matters**: my capture and collision checks were *cross-anchor only* —
they asked whether an anchor swallowed a **co-anchor's** text. That is the same blind spot
the fix itself has, so my sweep could not see an anchor handed **unanchored** text. Adding a
substitution check exposes 378 violations at HEAD where my earlier checks reported 0.
Separately, my must-hold A/B used `newBody.includes(sel.exact)` as its integrity column —
a predicate satisfied by *any* text present in `newBody`, which is why I passed TEST-67c.
Both probes have been rebuilt and re-run; the corrected results are below.

Environment: real `git init` scratch workspaces on real disk with real `doc.md` files
carrying `anchors:` frontmatter, `git diff -U0` as the instrument, plus black-box library
probes. Pre-round-2 engine reconstructed read-only from
`git show a776387:apps/server/src/anchors/*`. Scratch at `/tmp/eval-p2-scratch/r3-*`.
Repo tree clean; HEAD `46fa225`.

---

## What round 2 genuinely fixed

My round-2 FAIL-1 reproduction is gone. Same fixture, unchanged:

```
report: {"unchanged":[],"remapped":["anc_first","anc_fourth"],"orphaned":[]}
anc_first : 64ch (was 64) -> {209,273}     anc_fourth: 65ch (was 65) -> {8,73}
disjoint; each re-attached to its OWN relocated paragraph
```

On disk the frontmatter diff is only reordering plus refreshed context. Round 2's
cross-anchor pass does exactly what it claims, and the improvement is large and real.

## Corrected sweep — 1000 cases, 3006 anchors, HEAD vs pre-round-2

Own seeded generator: 7 shapes including all four reorder families, 4–6 paragraphs
(78 % near-identical / 22 % wholly-distinct controls), 2–4 anchors, 30 % sub-paragraph spans.

| check                                                                   | HEAD `46fa225` | pre-round-2 `a776387` |
| ----------------------------------------------------------------------- | -------------- | --------------------- |
| **A** `newBody.slice(start,end) !== exact`, or orphan not preserved       | 0              | 0                     |
| **B** capture — emitted exact contains a **disjoint co-anchor's** exact   | **0**          | **339**               |
| **C** collision — newly overlapping resolved ranges                       | **0**          | **114**               |
| **D** superset (`exact` grew > 1.2×)                                      | 2              | 28                    |
| **E** **substitution — handed unrelated text while its own text survives verbatim** | **378** | **695** |
| — of which near-identical documents (arguable)                            | **0**          | 0                     |
| — of which **wholly-distinct-text documents (unambiguous)**               | **378**        | 695                   |
| **G** truncated/extended while its own text survives                      | 0              | 0                     |

Round 2 eliminates capture and collision outright and roughly **halves** substitution
(695 → 378). It does not close it. **Every one of the 378 is in a wholly-distinct-text
document**, so none is the ambiguous "which near-identical twin is which" case — the anchor
is handed a paragraph with no lexical relationship to its own, while its own text sits
verbatim and uniquely elsewhere in the same document.

## Criteria Results

| #   | Criterion                                             | Result   | Notes                                                                                                                                                                                     |
| --- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 59  | The bug reproduces on disk before any fix             | PASS     | Verified in round 1 against the pre-fix engine, character for character.                                                                                                                    |
| 60  | The reproduced scenario is clean after the fix        | PASS     | `{"orphaned":["anc_one1","anc_two2"]}`, both selectors byte-preserved, frontmatter untouched, body-only `git diff`.                                                                          |
| 61  | Selector integrity is a general invariant             | **FAIL** | "never another range's text": **378 / 3006**. "never a superset": 2. Only `slice === exact` (0) and "never a prefix" (0, this generator) hold. See FAIL-1.                                   |
| 62  | The failure path falls through the adjudicated ladder | PASS     | Fuzzy bait: reorder with P1/P2 deleted while near-identical twins survive relocated → both `orphaned`, preserved. Fuzzy did not run.                                                         |
| 63  | Legitimate shrinking edits still remap                | PASS     | Shrink-to-a-few-words and pure boundary-crossing tail delete both `remapped` to the new range's full text. (A prefix here is *correct* — the original text is genuinely gone.)               |
| 64  | Both siblings deleted → both orphan, no contamination | PASS     | Both `orphaned`, byte-preserved, no cross-contamination.                                                                                                                                    |
| 65  | The M1 disk matrix stays green                        | PASS     | Anchor suite 8 files / **164 tests, 0 failures**.                                                                                                                                           |
| 66  | The four deletion scenarios still orphan              | PASS     | All four `orphaned`, selectors byte-preserved, frontmatter untouched, byte-identical to pre-round-2.                                                                                         |
| 67  | Cut-and-paste still re-attaches                       | **FAIL** | (a) and (b) resolve to their own moved text. **(c) does not** — two independent fixture variants both hand the anchor the *inserted filler*, while its own text survives uniquely. See FAIL-2. |
| 68  | Doppelgänger and plain deletion still orphan          | PASS     | (a) and (b) `orphaned` and preserved; the must-NOT-fix case still `remapped`.                                                                                                               |
| 69  | The escalating-context sequence stays all-remapped    | PASS     | All four rows `remapped`, resolving to their own text, context refreshed — verified with the corrected predicate.                                                                            |
| 70  | Determinism, purity and perf unchanged                | PASS     | Reorder path 200 runs → 1 distinct result. Order-independence across 4 key-insertion / id-sort permutations. Purity grep zero hits. Perf ratio flat at 1.15–1.22× from 25 → 400 anchors.      |

**Repo gates:** build ✓ · lint ✓ · format ✓ · typecheck ✓ · **1684 tests / 85 files, 0
failures** · coverage 99.56 / 96.26 / 100; `reconcile.ts` 100/100/100/100. All match the log.

## Failures

### FAIL-1: a `remapped` anchor is handed an unrelated paragraph while its own text survives verbatim

**Criterion**: TEST-61 — "never a prefix, never a superset, **never another range's text**."

**Hand-verified reproduction** (`/tmp/eval-p2-scratch/r3-verify-substitution.mts`) — six
**wholly distinct** paragraphs, one write swaps paragraph 4 and paragraph 6, **one** anchor:

```
anchored on : "Hiring is paused until the second half of next year at the earliest."  (old offset 217)

HEAD 46fa225   report: {"remapped":["anc_hire01"],"orphaned":[]}
  emitted exact : "Cash runway extends nineteen months under the current burn profile."
  resolves to   : {217,284}   slice===exact: true
  its own text still survives verbatim and UNIQUELY at 356

PRE-R2 a776387 : byte-identical output
```

The anchor kept its byte offset and was handed whatever text now occupies it. `slice ===
exact` holds — which is why a check built only on that predicate calls this clean — but the
selector now quotes a different paragraph entirely. A thread about the hiring freeze silently
becomes a thread about cash runway. Its own paragraph is sitting untouched 139 bytes away.

**Rate**: **378 / 3006 anchors (12.6 %)** at HEAD; 695 (23.1 %) pre-round-2. All in
wholly-distinct-text documents, concentrated in reorder and insert shapes.

**Not universal** — the ordinary case is correct. Three distinct paragraphs, promote the last
to the top, thread on the middle paragraph: `remapped`, resolves to `{150,216}`, which is
exactly where its own text now lives. The failure is specific to diff alignments where the
mapper keeps a byte offset across a relocation.

### FAIL-2: TEST-67 row (c) — the anchor does not follow the moved text

**Criterion**: TEST-67 — "An anchored sentence is … (c) moved far with extra paragraphs
inserted between. Then: All three report `remapped` **and resolve to the moved text**."

```
TEST-67c  moved far, 2 paragraphs inserted
  original exact (52ch): "We assume a 30-year fixed at 6.1% for the base case."
  emitted  exact (54ch): "An inserted paragraph one.\n\nAn inserted paragraph two."
  resolves to {62,116}  —  its own text is at {175,227}, unique
TEST-67c' moved far, 1 paragraph inserted
  resolves to {62,88}   —  its own text is at {147,199}, unique
```

Both variants `remapped`, both byte-identical to pre-round-2. The anchor is handed the
inserted filler. This is FAIL-1's class surfacing inside a named must-hold row.

**This row passed in my earlier reports because the check was wrong**, not because the
behaviour changed: I asserted `newBody.includes(sel.exact)`, which any resident text
satisfies. With the correct predicate — where the original text survives, the anchor must
resolve to *that* range — the row fails on both fixtures I built. A different fixture shape
(the parallel probe run) produced a 1-character trailing-period truncation instead of a full
substitution, so the row's outcome is fixture-sensitive; it is not robustly passing under any
of the three constructions tried.

## Assessment

**Round 2 is sound work and is not a regression.** It removes 339 capture and 114 collision
violations outright, halves substitution, keeps all 16 other must-hold rows byte-identical,
is order-independent and deterministic across the new pairwise pass, exempts nested anchors
correctly, handles byte-identical "musical chairs" paragraphs correctly, orphans a genuinely
deleted paragraph instead of stealing, and costs a flat ~15–22 % with no super-linear term.

**But TEST-61 is not met, and the gap is wider than the disclosed residual.** The issue log
discloses a single-anchor superset residual. The actual uncovered class is much larger: the
cross-anchor pass can only void a slice by comparing against **another anchor**, so any slice
that mangles *unanchored* text passes untouched — whether it swallows it (superset, ~0.07 %),
or is handed it wholesale (substitution, **12.6 %**). The guard's scope is cross-anchor; the
invariant's scope is per-anchor. That difference is the entire remaining failure set.

**On the letter-versus-harm question**: this is no longer a case where the letter is violated
but the harm is not. A thread quoting a paragraph it was never about — while its own
paragraph sits verbatim and unique elsewhere in the same document — is precisely the harm §6
promises against, and it does not require a second anchor to be visible to a user.

**Blocking versus follow-up remains the orchestrator's call**, and there is a defensible case
for shipping: everything here is pre-existing, round 2 strictly improves it, and the
remaining fix needs a design decision (re-placing any `partial` slice whose original text
still survives verbatim and uniquely) that touches the SERVER-002 "in-place edit evidence
outranks a verbatim duplicate elsewhere" adjudication this sprint declared closed. What
should **not** happen is recording the remainder as a narrow single-anchor superset residual —
the measured class is a 12.6 % substitution rate in distinct-text documents.

## Discrepancies between the round-2 log and observation

**DISC-1 — "0/1000 violations" is true only for the narrow predicate.** Confirmed for
`slice === exact` (0 / 3006) and for capture and collision (0 / 3006). Not true for TEST-61
as written, which also forbids "another range's text": 378 / 3006.

**DISC-2 — the disclosed residual's scope is understated twice over.** The log says "a
dishonest superset slice with no co-anchor … (single-anchor reorder)". Observed: (i) it also
fires in **multi-anchor** documents when the swallowed paragraphs are unanchored (19 in a
2-anchor reorder sweep) and when the would-be colliding co-anchor orphans; (ii) the superset
shape is the *rarer* half — substitution is 189× more common in this sweep.

**DISC-3 — "only the reorder family differs" is false as a general statement.** 16/16 named
must-hold rows are byte-identical, which is what the log directly claims and it holds. But at
sweep level HEAD differs from pre-round-2 well outside the reorder family, and the parallel
probe run measured 208/1000 cases differing including delete-edit and random-edits.

**DISC-4 — "227/1000 pre-round-2" is not reproducible with an independent generator.** My
pre-round-2 figures on my own seeds: 339 capture + 114 collision + 695 substitution.
Direction and magnitude of the improvement are confirmed; the specific count is
generator-dependent and should not be quoted as an absolute.

**DISC-5 — perf absolutes differ, direction agrees.** Machine- and fixture-dependent; the
order-of-magnitude bar is met either way.

## Summary

**10 of 12 acceptance tests pass.** Round 2's cross-anchor pass is real, well-targeted and
regression-free: capture 339 → 0, collision 114 → 0, substitution 695 → 378, all 16 other
must-hold rows byte-identical, order-independent, deterministic, no perf blow-up. **TEST-61
still fails** — an anchor is handed a wholly unrelated paragraph in 12.6 % of swept anchors
while its own text survives verbatim and uniquely — and **TEST-67(c) fails** as a named
instance of that class. Both are pre-existing and byte-identical to pre-round-2. My earlier
round-3 PARTIAL was based on two checks that shared the fix's own cross-anchor blind spot;
corrected here.

---

## Appendix — round-2 record (superseded, kept for the audit trail)

Round-2 verdict was **FAIL** on TEST-61: a whole-document reorder of near-identical
paragraphs emitted a `remapped` selector whose `exact` was a 130-character superset
containing another anchor's entire 65-character paragraph, ranges overlapping
(`{143,273}` ⊃ `{209,273}`), with `classify=partial, straddledByReplacement=false` so
round 1's guard never fired. Verified pre-existing against `4296717`. **Round 2 fixes this
specific reproduction** — verified directly at HEAD: 65 chars, `{8,73}`, disjoint.

Round 2 also recorded that "cut-and-paste ×3 … byte-identical to pre-fix" was false for row
(b) against the *round-1* baseline. Against `a776387` all three rows are byte-identical; row
(c) is now shown to be failing on its own merits (FAIL-2), not on an A/B difference.
