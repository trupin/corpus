# Evaluation: SERVER-012

**Date**: 2026-07-26
**Sprint**: sprint-002
**Verdict**: FAIL — 11 of 12 acceptance tests pass; **TEST-61 fails**

The fix is real and it works: the reproduction is genuine, the sibling-deletion truncation
family is eliminated, the adjudicated ladder is respected, legitimate shrinks still remap,
and every SERVER-002 round-3 must-hold reproduces. But TEST-61's invariant is stated as a
**general** property — "never a prefix, never a superset, never another range's text" — and
it does not hold generally. A whole-document reorder of near-identical paragraphs still
produces a `remapped` selector whose `exact` is double its original length and contains a
neighbouring anchor's entire paragraph, with the two anchors' resolved ranges overlapping.

**This is pre-existing, not a regression** — the pre-fix engine emits the identical
130-character selector for the same input. I verified that myself. It is nonetheless a
failure of the acceptance test as written, and of the issue's own second acceptance
criterion, so it is recorded as a FAIL rather than waived.

Environment: real `git init` scratch workspaces on real disk, real `doc.md` files with
`anchors:` frontmatter, `git diff -U0` as the observation instrument, real `tsx` drivers
against freshly built sources. Pre-fix engine reconstructed from
`git show 4296717:apps/server/src/anchors/*` into `/tmp/eval-p2-scratch/prefix-anchors/`
(read-only; the repo working tree was never touched). Scratch also at
`/tmp/eval-p2-anchors/`. Repo tree verified clean before and after.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Reproduction section plus per-test post-implementation sections TEST-60…70 and a gate block.                                                                                   |
| Commands are specific and concrete      | PASS   | Named driver scripts, named scratch workspaces, verbatim report JSON, verbatim `git diff -U0` hunks, a segment-level root-cause dump.                                          |
| Real E2E (not mocked)                   | PASS   | Real `mkdtemp` git workspaces, real save path, real `git diff`. The pre-fix engine is kept as a black box and A/B'd, which is the right instrument.                            |
| Scenarios cover acceptance criteria     | PASS   | Every acceptance criterion has a section. (Coverage ≠ correctness — see FAIL-1.)                                                                                               |
| Application restarted after changes     | PASS   | "All verification against freshly built sources (`npm run build` from a clean tree)."                                                                                          |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: fable (claude-fable-5)**", stated in both the Reproduction and the Post-Implementation sections.                                                             |
| Reproduction logged before fix (bugs)   | PASS   | **Verified against the pre-fix engine, character for character** — see TEST-59. The reproduction is not fabricated.                                                             |

## Criteria Results

| #   | Criterion                                                | Result   | Notes                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 59  | The bug reproduces on disk before any fix                | PASS     | Pre-fix engine, the log's exact fixture: `{"remapped":["anc_one1","anc_two2"]}`, `anc_one1.exact = "Paragraph one now has orang"` (truncated mid-word), `anc_two2.exact = "oranges and pears in the basket today."` (the surviving sibling's text). Matches the logged strings **character for character**; the frontmatter block was touched. |
| 60  | The reproduced scenario is clean after the fix           | PASS     | Same fixture, same write, fixed engine: `{"orphaned":["anc_one1","anc_two2"]}`, both selectors byte-preserved, `frontmatter block touched: false`, `git diff -U0` body-only. No truncation, no cross-handed text, no third outcome.                        |
| 61  | Selector integrity is a general invariant                | **FAIL** | An independent 1000-case seeded sweep found **6 hard violations at HEAD**, all of the whole-document-reorder shape. Reproduced by me standalone: a `remapped` anchor's `exact` grows 65 → 130 chars and contains another anchor's entire paragraph; the two ranges overlap. See FAIL-1. |
| 62  | The failure path falls through the adjudicated ladder    | PASS     | With a fuzzy-matchable near-identical sibling present, a straddled `partial` was **not** taken from the mapper, `resolveAnchorExact` returned `null`, the full ladder (`resolveAnchor`, fuzzy) **would** have attached it to the sibling — and the engine orphaned instead, selector byte-preserved. Fuzzy proven not to run. A second case shows the exact tier ran and insertion-overlap rejected the hit. A control case (deleted text re-typed verbatim by the same write) still remaps, so the guard is not a blanket orphan. |
| 63  | Legitimate shrinking edits still remap                   | PASS     | 6/6 shrink shapes `remapped` with `exact` equal to the new range's full text, including both pure boundary-crossing deletes with no insertion (`"We assume a 30-year fixed"`, `"6.1% for the base case."`). All byte-identical to pre-fix. Confirmed on disk. |
| 64  | Both siblings deleted → both orphan, no contamination    | PASS     | `{"orphaned":["anc_one1","anc_two2"]}`, both selectors byte-preserved, frontmatter untouched, body-only `git diff`. Neither acquired the other's text.                                                                                                     |
| 65  | The M1 disk matrix stays green                           | PASS     | 5/5 reproduce their round-3 outcomes: sprint-001 TEST-22 `unchanged` (frontmatter untouched); TEST-23 `unchanged` (same offsets `{75,127}`); TEST-24 `remapped` with `exact` quoting the edited sentence verbatim; TEST-25 `orphaned` with a byte-identical selector and a body-only diff; TEST-26 `remapped`, `exact` unchanged, `prefix`/`suffix` refreshed at exactly 32 chars each. |
| 66  | The four deletion scenarios still orphan                 | PASS     | Near-identical paragraphs, the middle bullet, the Q2 table row and the verbatim-copy case: all `orphaned`, all selectors byte-preserved, all `frontmatter touched: false`, all body-only diffs, all byte-identical to pre-fix.                             |
| 67  | Cut-and-paste still re-attaches                          | PASS     | (a) down past the tail, (b) up above the lead, (c) far with inserted paragraphs — all three `remapped` and resolving to the moved text. See DISC-1: (b) is **not** byte-identical to pre-fix as the log claims, and HEAD's value is the better one.        |
| 68  | Doppelgänger and plain deletion still orphan             | PASS     | (a) twin in untouched text → `orphaned`, preserved; (b) no twin → `orphaned`, preserved, re-resolves to `null`. The must-not-fix case — delete here + identical text inserted in an unrelated section — still `remapped`. All byte-identical to pre-fix.    |
| 69  | The escalating-context sequence stays all-remapped       | PASS     | 4/4 `remapped` with `exact` unchanged and `prefix`/`suffix` equal to `computeContext(newBody, …)`, including row 4 ("both neighbours rewritten"), which was round 1's bug. All byte-identical to pre-fix.                                                  |
| 70  | Determinism, purity and perf unchanged                   | PASS     | Determinism: mixed-outcome fixture ×100 → 1 distinct result; 1 MB body ×100 → 1 distinct result. Purity: sanctioned grep over the 7 non-test anchor modules for `node:fs`/`node:child_process`/`better-sqlite3`/`core/` → **zero hits**; only `diff-match-patch`, relative siblings and one type-only contract import. Immutability: deep-frozen inputs did not throw, inputs deep-equal after the call, result is a distinct object. Perf A/B (HEAD vs pre-fix, same inputs): 1 MB/50 anchors 5.03 ms vs 5.34 ms; 1 MB sibling scenario 6.18 ms vs 5.64 ms; 50 anchored paragraphs all deleted 1.25 ms vs 1.21 ms — same order of magnitude, nothing near the 1 s `Diff_Timeout`. |

Repo suite: `npx vitest run apps/server/src/anchors` → **34 suites / 157 tests, 0 failures**;
full repo → **85 files / 1677 tests, 0 failures**.

## Failures

### FAIL-1: A `remapped` selector can still be a superset carrying another anchor's text

**Criterion**: TEST-61 — "For every **remapped** anchor, `newBody.slice(start, end) ===
selector.exact` exactly — never a prefix, never a superset, never another range's text. A
single violation fails the sweep and names the seed." Also SERVER-012 acceptance criterion 2
("A remapped selector's `exact` always equals the full text of the range it claims …
enforced as a general invariant test over the reconcile property sweep, not just the one
fixture") and the issue's own Summary, which names "handing one anchor another anchor's
text" as the defect being fixed.

**Expected**: after reconciliation, no `remapped` anchor's selector contains another
anchor's text, and no two anchors resolve to overlapping ranges.

**Observed**: `anc_fourth`'s `exact` grows from 65 to 130 characters and contains
`anc_first`'s entire paragraph; `anc_fourth` resolves to `{143,273}`, which strictly
contains `anc_first`'s `{209,273}`. Both are reported `remapped`. On disk the two anchors
end up with identical `prefix`/`suffix` and one `exact` block-scalar quoting the other's
sentence. The mapper reports `classify=partial, straddledByReplacement=false`, so the new
guard never fires.

**Steps to reproduce** (pure library, no disk needed —
`/tmp/eval-p2-scratch/verify-t61.mts`):

1. Build the repo (`npm run build`).
2. Import `computeContext`, `reconcileAnchors`, `resolveAnchor` from
   `apps/server/src/index.ts`.
3. Build four near-identical paragraphs and reverse their order in one write:
   ```ts
   const P1 = "Paragraph one now has margin and cherries in the budget quarter.";
   const P2 = "Paragraph two now has margin and cherries in the budget quarter.";
   const P3 = "Paragraph three now has margin and cherries in the budget quarter.";
   const P4 = "Paragraph four now has margin and cherries in the budget quarter.";
   const oldBody = `\n# Doc\n\n${P1}\n\n${P2}\n\n${P3}\n\n${P4}\n\nA closing paragraph that stays put.\n`;
   const newBody = `\n# Doc\n\n${P4}\n\n${P3}\n\n${P2}\n\n${P1}\n\nA closing paragraph that stays put.\n`;
   ```
4. Anchor `anc_first` on `P1` and `anc_fourth` on `P4`, selectors built with
   `computeContext`.
5. Run `reconcileAnchors(oldBody, newBody, anchors)`.

**Actual output at HEAD** (`a776387`):

```
report: {"unchanged":[],"remapped":["anc_first","anc_fourth"],"orphaned":[]}

anc_first:
  exact (64 chars, original 64): "Paragraph one now has margin and cherries in the budget quarter."
  resolves to: {"start":209,"end":273}
  contains the OTHER anchor's original text: false
anc_fourth:
  exact (130 chars, original 65): "Paragraph two now has margin and cherries in the budget quarter.\n\nParagraph one now has margin and cherries in the budget quarter."
  resolves to: {"start":143,"end":273}
  contains the OTHER anchor's original text: true
  is a single whole paragraph of newBody : false
```

**Same input on the pre-fix engine** (`4296717`, extracted read-only):

```
anc_first:
  exact (14 chars, original 64): "Paragraph four"          <- SERVER-012 repaired this one
anc_fourth:
  exact (130 chars, original 65): "…budget quarter.\n\nParagraph one now has …budget quarter."   <- unchanged
```

So SERVER-012 repaired the truncation arm of this shape and left the superset arm intact.

**Rate**: 6 violations in 1000 seeded cases, all of the `reorder-all` shape. The repo's own
sweep is green because its generated shapes do not include a whole-document reorder of
near-identical paragraphs — the invariant is asserted, but over a shape space that cannot
exhibit this family.

**Scope note for the orchestrator.** The sprint's Out of Scope excludes "reworking the
`deleted` classification path" and says SERVER-012 "guards the **quality of the slice** the
`partial` path trusts, and nothing else". This case *is* a `partial`-path slice of bad
quality, so it is in scope by that wording. It is however **not a regression**, and the
product consequence — two threads anchored to overlapping text, one quoting the other's
paragraph — is a §6 correctness problem that predates this issue. Whether to fix it here or
file it as SERVER-013 is an orchestrator call; my mandate is to report that the acceptance
test as written does not pass.

## Discrepancies between the E2E log and observation

**DISC-1 — "Cut-and-paste ×3 … byte-identical to pre-fix" is false for row (b).**
Independently verified (`/tmp/eval-p2-scratch/verify-t67b.mts`), moving the anchored
sentence up above the lead paragraph:

```
HEAD   exact = "We assume a 30-year fixed at 6.1% for the base case."                            (52 chars, original 52)
PREFIX exact = "We assume a 30-year fixed at 6.1% for the base case.\n\nThe finance model has three inputs that matter most."   (106 chars)
byte-identical to pre-fix: false
```

TEST-67 still passes (all three rows `remapped` and resolving to the moved text) and HEAD's
value is the **correct** one — but the blanket "byte-identical" claim is inaccurate, and it
happens to conceal a second superset case that the fix *does* repair. A log that overstates
sameness makes the next A/B harder to trust.

**DISC-2 — "TEST-61 … asserted inside both property sweeps … Green" overstates what is
proven.** The repo's sweeps are green (157/157); the invariant does not hold over shapes the
generator does not emit. See FAIL-1.

**DISC-3 — the perf figures do not reproduce as absolute numbers.** Log: "HEAD 7.7 ms vs
pre-fix 7.4 ms" (1 MB/50) and "7.8 vs 7.5" (sibling). Measured here: 5.03 vs 5.34 and 6.18
vs 5.64. Direction and order of magnitude agree; the absolutes are machine-dependent. Not a
defect — noted because the log presents them as measurements without stating the machine.

**DISC-4 — the test-count claim ("848 passed / 55 files") is stale.** HEAD runs 1677 tests
across 85 files after CONTRACT-002, SERVER-003 and CLI-001 landed. Expected drift.

## Observation (not a listed test)

A multi-edit write can now orphan an anchor whose paragraph was **edited in place and still
exists**: with four edits in one write, `"A sentence that gets edited right here in place."`
→ `"…in situ."` classifies `partial` with `straddled=true` and orphans (selector preserved),
whereas the same edit in isolation remaps correctly. Pre-fix remapped it, but onto a
corrupted superset. This is the conservative trade the issue's log discloses, and TEST-60
explicitly admits orphan-with-preserved-selector as acceptable — but the cost now lands on
genuinely-surviving edited text, not only on deleted text. Worth knowing before SERVER-005
wires reconciliation into the real save path.

## Summary

**11 of 12 acceptance tests pass.** The reproduction is genuine and matches its log
character for character; the fix eliminates the sibling-deletion truncation family
completely (40 → 0 hard violations across a 1000-case sweep) without disturbing shrinks,
cut-and-paste, doppelgängers, the escalating-context sequence, the M1 disk matrix, the four
deletion scenarios, determinism, purity or perf. **TEST-61 fails**: the general
slice-integrity invariant does not hold for whole-document reorders of near-identical
paragraphs, where a `remapped` selector can still be a superset containing another anchor's
text. That failure is pre-existing rather than introduced here, which bears on whether it
blocks this issue or becomes a follow-up — but it is a failure of the test as written.
