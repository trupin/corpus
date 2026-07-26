# [SERVER-012] Anchor engine: partial-path can emit truncated selectors beside near-identical edited siblings

## Domain

server

## Status

in_progress

## Priority

P2

## Model

fable — same judgment-heavy diff-range territory as SERVER-002; the fix must not regress the round-2/round-3 adjudications recorded in server-dev Domain Knowledge.

## Dependencies

- Depends on: SERVER-002
- Blocks: —

## Spec References

- SPEC.md §6 — anchor reconciliation ladder, selector update rules
- `.claude/agents/server-dev.md` → Domain Knowledge — the FAIL-1/FAIL-2 adjudications (diff is advisory; deleted-claim verification is exact-only + insertion-overlap)
- `issues/evals/SERVER-002-eval.md` — round 3, observation 2 (discovery record)

## Summary

Found by the evaluator during SERVER-002's round-3 pass, outside the sprint's M1 matrix, and byte-identical on the pre-fix engine (i.e. pre-existing, not a regression): deleting a paragraph that sits beside a near-identical paragraph that was **also edited** in the same write can drive the `partial` mapper path into emitting truncated selectors (e.g. `exact: "Paragraph one now"`) and handing one anchor another anchor's text. The `partial` path trusts the offset mapper by design (adjudicated in SERVER-002 round 2 — in-place-edit evidence outranks a verbatim duplicate elsewhere); this issue is about the quality of the mapped slice it trusts, not about re-opening that adjudication.

## Acceptance Criteria

- [x] Reproduce the evaluator's scenario as a regression test: two near-identical paragraphs, one deleted and one edited in the same write, each carrying an anchor — no anchor ends up with a truncated `exact` or with text that belonged to the other anchor.
- [x] A remapped selector's `exact` always equals the full text of the range it claims (`newBody.slice(start, end)`), never a truncation — enforced as a general invariant test over the reconcile property sweep, not just the one fixture.
- [x] When the mapped slice for a `partial` range fails that invariant (degenerate/truncated), the anchor takes the deleted-claim verification path (exact-only + insertion-overlap) instead of trusting the slice; if that also fails, it orphans with the selector preserved byte-for-byte.
- [x] The SERVER-002 round-2/round-3 must-holds all still pass: TEST-26 remapped, the four deletion scenarios orphaned, cut-and-paste re-attaches, doppelgänger orphans, escalating-context sequence all-remapped, M1 disk matrix green.
- [x] Determinism, purity, immutability, and perf order of magnitude unchanged.

## Technical Design

### Files to Create/Modify

- `apps/server/src/anchors/reconcile.ts` — slice-quality guard on the `partial` path
- `apps/server/src/anchors/reconcile.test.ts` — the sibling scenario + the general invariant over the property sweep

### Key Implementation Details

The `partial` path currently accepts whatever `mapStart`/`mapEnd` produce. The likely shape: validate the mapped slice before accepting it (non-degenerate length relative to the original `exact`, and the emitted selector round-trips through `resolveAnchorExact` against `newBody` to its own range); on failure, fall through to the same verification ladder the `deleted` classification uses. Keep the adjudicated hierarchy intact: mapper first, exact-only verification second, orphan last, fuzzy never on deletion-shaped claims.

### Edge Cases

- Legitimate shrinking edits (the anchored text genuinely edited down to a few words) must still remap — the invariant is "slice equals what the selector claims", not "slice is long".
- Both siblings deleted → both orphan (no cross-contamination).
- The scenario at 1 MB scale stays within the perf budget.

## Testing Strategy

Vitest in `apps/server`: the reproduction fixture, the general slice-integrity invariant folded into the seeded property sweep, and a disk test in `reconcile.disk.test.ts` mirroring the evaluator's on-disk methodology.

## E2E Verification Plan

### Verification Steps

1. Reproduce the evaluator's scenario pre-fix on disk (git-diff-observed truncated selector) and log it.
2. Post-fix: same scenario shows either a full-text remap or a byte-for-byte preserved orphan — never a truncated selector.
3. Re-run the SERVER-002 round-3 evaluator scenarios and confirm identical outcomes.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)

**Pre-fix, on disk, 2026-07-26 — implemented on: fable (claude-fable-5).** Engine at worktree
base (main, post-SERVER-002 commit `4296717`), freshly `npm install` + `npm run build`.

Real `git init` scratch workspace (`mkdtemp` → `/var/folders/.../corpus-s012-repro-qZs2vv`),
one real markdown file `doc.md` with an `anchors:` frontmatter block, seeded and committed;
driver script `tsx /tmp/server012/repro-disk.ts` plays the server's save path (read → edit →
`reconcileAnchors` → write back), `git diff -U0` is the observation instrument.

**Fixture** (TEST-59's Given — constructed from the eval's shape, since round 3 recorded no
literal fixture):

- `P1 = "Paragraph one now has apples and pears in the basket today."` — anchor `anc_one1`
- `P2 = "Paragraph two now has apples and pears in the basket today."` — anchor `anc_two2`
- body: `\n# Doc\n\n${P1}\n\n${P2}\n\nA closing paragraph that stays put.\n`
- **The single write**: delete `P2`, edit `P1` (`apples` → `oranges`) — the sibling is
  edited, not deleted.

**Observed** (pre-fix):

```
report: {"unchanged":[],"remapped":["anc_one1","anc_two2"],"orphaned":[]}
anc_one1.exact: "Paragraph one now has orang"        <- truncated, cut mid-word
anc_two2.exact: "oranges and pears in the basket today."  <- the OTHER (surviving, edited P1) paragraph's text
```

`git diff -U0` (frontmatter, abridged to the two anchors' `exact` lines):

```
-    exact: Paragraph one now has apples and pears in the basket today.
+    exact: Paragraph one now has orang
...
-    exact: Paragraph two now has apples and pears in the basket today.
+    exact: oranges and pears in the basket today.
+    prefix: |-
+      ...
+      Paragraph one now has
```

Both TEST-59 predicates hold at once: `anc_one1`'s emitted `exact` is a truncation of the
range it should claim (the surviving paragraph continues `...es and pears...`), and
`anc_two2` has been handed text that belongs to the surviving edited sibling.

**Root cause** (established with a segment-dump probe, `/tmp/server012/probe2.ts`): the diff
aligns the deleted paragraph against its near-identical edited sibling, producing
DELETE+INSERT replacement pairs whose DELETE **straddles** an anchor's range boundary
(starts before the range's start, or ends past its end). `mapStart` collapsing into such a
DELETE (and `mapEnd`'s grant of the following INSERT) hands the whole replacement to the
range even though it also replaces text *outside* the range — the mapped slice is then a
mid-word truncation and/or the neighbour's text. Segment dump for the fixture above:

```
op= 0 old[0,30)   "\n# Doc\nParagraph one now has "
op=-1 old[30,95)  "apples and pears in the basket today.\n\nParagr..."   <- straddles anc_one1's end (67) AND anc_two2's start (69)
op= 1 new[30,35)  "orang"                                                <- granted to both mapped ranges
op= 0 old[95,166) "es and pears in the basket today.\n\nA closing ..."
```

The four legitimate `partial` shapes (in-range tail rewrite, shrink-to-a-few-words,
pure boundary-crossing delete with no insert, in-range word replacement) show **no**
boundary-straddling replacement — the discriminator is causal, not statistical.

### Post-Implementation Verification

**Implemented on: fable (claude-fable-5).** All verification against freshly built sources
(`npm run build` from a clean tree), real disk, real `git init` scratch workspaces under
`/tmp`, real `tsx` scripts — no mocks. Pre-fix engine snapshot (worktree base = main,
`4296717`) kept at `/tmp/server012/prefix-anchors/` and imported as a black box for every A/B.

**Fix shape**: `OffsetMapper` grows one seam, `straddledByReplacement(range)` — true iff a
DELETE+INSERT replacement pair's DELETE strictly contains the range's `start` or `end`.
`reconcileAnchors` rejects the mapped slice of a `partial`-classified range when that fires
and routes the anchor through the existing `reattachOrOrphan` (exact-only rungs 1–2 +
`touchesInsertion`, fuzzy never, orphan last with the selector preserved byte-for-byte).
`equal`-classified ranges cannot be straddled (a straddling DELETE would have touched them),
so kept-anchor paths run zero extra work; pure deletions crossing a boundary (no INSERT) and
replacements wholly inside the range are untouched — legitimate shrinks still remap.

**TEST-60 — reproduction scenario clean after the fix** (same fixture, same write, same git
instrument; workspace `/var/folders/.../corpus-s012-repro-DzUoi5`):

```
report: {"unchanged":[],"remapped":[],"orphaned":["anc_one1","anc_two2"]}
anc_one1.exact: "Paragraph one now has apples and pears in the basket today."   <- preserved byte-for-byte
anc_two2.exact: "Paragraph two now has apples and pears in the basket today."   <- preserved byte-for-byte
--- git diff -U0 ---            <- body-only; the anchors frontmatter block is untouched
-Paragraph one now has apples and pears in the basket today.
-
-Paragraph two now has apples and pears in the basket today.
+Paragraph one now has oranges and pears in the basket today.
```

No truncated `exact`, no cross-handed text, no third outcome. (Neither original text
survives verbatim, so both orphan; the `anc_one1` false orphan is the adjudicated
conservative outcome — visible and recoverable, unlike the silent misattribution it
replaces. When the same write re-types the deleted paragraph in inserted text, the anchor
still re-attaches — covered by a unit test.)

**TEST-61** — slice-integrity invariant asserted inside both property sweeps (the original
40-seed sweep and a new 40-seed sweep over a body of near-identical sibling paragraphs,
seeds named in failure messages): every remapped/unchanged selector resolves and
`newBody.slice(range) === exact`. Green.

**TEST-62** — fall-through pinned by fixture-rot guards (`classify === "partial"` and
`straddledByReplacement === true` asserted via the exported mapper) plus the doppelgänger
case: straddled partial whose exact resolves in *unedited* text orphans (insertion-overlap
rejects the hit — proof the exact tier ran and fuzzy did not; the near-identical sibling
would satisfy fuzzy and never re-attaches).

**TEST-63** — legit shrinks remap (`"We assume 6.1%."`), including a pure delete crossing
the tail boundary (`"We assume a 30-year fixed"`). **TEST-64** — both siblings deleted in
one write: both orphaned, selectors preserved, no cross-contamination (unit + disk).

**TEST-65/66/67/68/69 — round-3 must-holds, A/B'd against the pre-fix engine**
(`tsx /tmp/server012/ab-verify.ts` + `tsx /tmp/server012/deletions-disk.ts`, the latter a
real git workspace, `git diff -U0`):

- M1 disk matrix (`reconcile.disk.test.ts`, incl. the byte-for-byte bullet row and the new
  sibling row): all rows green in the suite.
- Four deletion scenarios (paragraphs / bullets / table row / doppelgänger): `orphaned`,
  `frontmatter-touched=false`, body-only `git diff`, **byte-identical to pre-fix** in-memory.
- Cut-and-paste ×3 (down past tail, up above lead, far with inserted paragraphs):
  `remapped`, byte-identical to pre-fix.
- Escalating-context ×4 (incl. TEST-26 "both neighbours rewritten" → `remapped`):
  byte-identical to pre-fix.

**TEST-70 — determinism / purity / perf**:

- Sibling scenario ×100 → 1 distinct serialized result.
- Purity: `diff.ts` imports only `diff-match-patch` + sibling `types.js`; `reconcile.ts`
  only sibling modules; grep for `node:fs`/`node:child_process`/`better-sqlite3`/`core/`
  over non-test anchor modules: zero hits.
- Perf A/B (same inputs, both engines): 1 MB / 50 anchors / one insertion — HEAD 7.7 ms vs
  pre-fix 7.4 ms; 1 MB sibling scenario — 7.8 ms vs 7.5 ms (buckets 49/1/2 vs pre-fix's
  49/3/0 — the two twins now orphan instead of taking corrupted selectors, the fix itself);
  50 anchored paragraphs all deleted — 11.4 ms vs 7.9 ms. Same order of magnitude
  everywhere; the straddle check never runs for `equal`/`deleted` classifications.

**Repo gates** (final state): `npm run build` ✓ · `npm run lint` ✓ (0 problems) ·
`npm run format:check` ✓ · `npm run typecheck` ✓ (5 workspaces) · `npm test` **848 passed /
55 files** (828 baseline + 20 new SERVER-012 tests, zero regressions) · coverage 99.76%
lines / 95.72% branches / 100% functions (gate 90%).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-012]` prefix
