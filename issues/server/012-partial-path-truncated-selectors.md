# [SERVER-012] Anchor engine: partial-path can emit truncated selectors beside near-identical edited siblings

## Domain

server

## Status

done

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
  `remapped`. **Correction (round 2, per eval DISC-1)**: rows (a)/(c) byte-identical to
  pre-fix; row (b) is **not** — pre-fix emitted a 106-char selector (the moved sentence
  plus the lead paragraph), the fixed engine emits the correct 52-char sentence. The
  round-1 "byte-identical" claim was overbroad; the difference is itself a superset case
  the fix repaired.
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

**Repo gates** (round-1 state): `npm run build` ✓ · `npm run lint` ✓ (0 problems) ·
`npm run format:check` ✓ · `npm run typecheck` ✓ (5 workspaces) · `npm test` **848 passed /
55 files** (828 baseline + 20 new SERVER-012 tests, zero regressions) · coverage 99.76%
lines / 95.72% branches / 100% functions (gate 90%).

### Round 2 — the superset arm (evaluator FAIL-1: TEST-61)

**Implemented on: fable (claude-fable-5).** Round-2 verdict: round 1 eliminated the
truncation arm but a whole-document reorder of near-identical paragraphs still emitted a
`remapped` selector whose `exact` was a 130-char superset containing another anchor's
entire 65-char paragraph, the two resolved ranges overlapping — `classify=partial`,
`straddledByReplacement=false`, so the round-1 guard never fires. Pre-existing (identical
on the pre-fix engine).

**Reproduction (before any code change), 2026-07-26.** Evaluator's fixture rebuilt from
the verdict (`tsx /tmp/server012-r2/repro.mts`) against repo HEAD (pre-fix for this arm),
freshly built:

```
report: {"unchanged":[],"remapped":["anc_first","anc_fourth"],"orphaned":[]}
anc_first : exact (64 chars) "Paragraph one …quarter."   resolves to {209,273}
anc_fourth: exact (130 chars, original 65)
            "Paragraph two …quarter.\n\nParagraph one …quarter."  resolves to {143,273}
ranges overlap: true          <- matches the verdict character for character
anc_fourth: old=[208,273) classify=partial straddled=false mapped=[143,273)
```

Independent 1000-case seeded sweep with reorder shapes (`tsx sweep1000.mts`, shapes:
reverse/rotate/swap/shuffle/delete-edit/random-edits over 4–6 near-identical paragraphs,
2–4 anchors): **227/1000 violating cases pre-fix**, all in the four reorder shapes
(supersets carrying a co-anchor's paragraph, newly-overlapping resolved ranges);
`delete-edit` and `random-edits` (the round-1 family) clean — round 1 holds, the miss is
exactly the reorder family.

**Root cause (segment probe, logged above in the repro output).** The reversal diff
cross-aligns: for `anc_fourth` (old `[208,273)`) only `"four"` (old `[218,222)`) is
deleted — a replacement **wholly inside** the range, boundary-respecting — but the INSERT
replacing it is 69 chars of *relocated* text (`"two …quarter.\n\nParagraph "`). The mapped
slice `[143,273)` is then survivors + insertion by segment accounting (monotonicity keeps
foreign EQUAL text out of every mapped span), so no segment-level detector can see the
dishonesty; the guidance's plain self-round-trip also passes (the emitted window is unique
— probed explicitly, `probe-detectors.mts`). The honest, causal signals are cross-anchor:
**(collision)** `mapStart`/`mapEnd` are monotone, so anchors with disjoint old ranges can
only overlap in `newBody` if a slice misattributed text; **(capture)** a rewritten slice
containing a disjoint co-anchor's entire `exact` is quoting that anchor's text wherever it
landed (the shuffle "musical chairs" cases collide with nothing). Both exempt pairs whose
old ranges already overlapped — nested/overlapping anchors are legal and move together.

**Fix shape** (`reconcile.ts` restructured into draft → cross-anchor pass → finalize; the
public API, `diff.ts` and all round-1 seams untouched):

- per-anchor (pass 1), a rewritten `partial` slice must now also **self-round-trip**
  (emitted selector resolves via `resolveAnchorExact` back to exactly its own range —
  acceptance criterion 2's second clause; catches shadowed-duplicate windows that would
  silently send the thread to an identical earlier block);
- cross-anchor (pass 2), rewritten slices that **collide** (newly-created overlap) or
  **capture** a disjoint co-anchor's exact are voided against the pass-1 snapshot
  (order-independent detection) and re-placed in sorted order through the adjudicated
  chain — exact-only rungs 1–2 + `touchesInsertion`, fuzzy never, orphan last with the
  selector preserved byte-for-byte; a re-attachment must not itself newly collide;
- a slice equal to its old exact is verbatim survival and outranks any rewritten claim —
  verbatim/`equal`/unchanged paths run zero extra work, and the partial-trusts-mapper
  adjudication is untouched for honest slices (no straddle, round-trips, no collision, no
  capture ⇒ mapper wins, exactly as before).

**Post-fix verification** (all real runs, freshly built sources):

- Fixture: both anchors `remapped` to their **own relocated paragraphs** — `anc_fourth`
  re-attaches at `{8,73}` (P4's new home, rung 2 + insertion-overlap), `anc_first` at
  `{209,273}`; disjoint, no superset. Better than orphaning: the thread follows its text.
- Sweep: **0/1000 violating cases** (pre-fix 227). Outcome quality: remapped 2186→2142,
  orphaned 201→243 — most previously-corrupted anchors now re-attach correctly; the rest
  orphan visibly with selectors preserved.
- On disk (`tsx repro-disk-r2.mts`, real `git init` workspace
  `/var/folders/.../corpus-s012r2-*`, save-path shape, `git diff -U0`): pre-fix engine
  persists `exact: |-` (130-char two-paragraph block scalar), ranges `{143,273}⊃{209,273}`;
  fixed engine persists the 65-char paragraph, ranges `{8,73}` / `{209,273}` disjoint.
- Must-hold A/B vs the pre-fix snapshot (`tsx ab-verify-r2.mts`, snapshot =
  HEAD-before-round-2 at `/tmp/server012-r2/prefix-anchors`): **0 failures, all
  byte-identical** — TEST-66 four deletion scenarios, TEST-69 escalating-context ×4 (incl.
  TEST-26), TEST-67 cut-and-paste ×3, round-1 TEST-59/60 sibling fixture, both-siblings
  deleted, re-typed re-attach, straddled doppelgänger, TEST-63 shrinks ×3 (incl. pure
  boundary-crossing delete). Only the reorder family differs — the fix itself.
- Determinism ×100 → 1 distinct serialized result; deep-frozen inputs: no throw, inputs
  unchanged, distinct output object.
- Perf A/B (same machine, same inputs): 1 MB/50 anchors 7.2 ms vs 7.6 ms pre-fix; 1 MB
  sibling 7.7 vs 7.6; 50 anchored paragraphs all deleted 10.3 vs 7.4; 60 near-identical
  anchored paragraphs document-reversed 5.0 vs 3.0 (59 remapped / 1 orphaned — one block
  sits wholly in the diff's common-subsequence run, fails insertion-overlap, orphans
  visibly). Same order of magnitude everywhere.
- New tests (7): the reorder fixture + fixture-rot guard pinning the non-straddled seam,
  capture-with-twin → orphan preserved, nested-anchors exemption, shadowed-window
  round-trip rejection, a 40-seed reorder sweep asserting the general invariant **and**
  no-newly-overlapping-resolved-ranges directly (the sibling sweep also gained the direct
  overlap assertion), and a disk-matrix reorder row.

**Repo gates** (round-2 final state): `npm run build` ✓ · `npm run lint` ✓ (0 problems) ·
`npm run format:check` ✓ · `npm run typecheck` ✓ (5 workspaces) · `npm test` **1684
passed / 85 files** (1677 baseline + 7 new, zero regressions) · coverage 99.56% lines /
96.26% branches / 100% functions (gate 90%); `reconcile.ts` 100/100/100/100.

**Known residual (disclosed, out of this issue's cross-anchor bar):** a dishonest superset
slice with **no co-anchor** to collide with or capture still emits (single-anchor reorder)
— no per-anchor, non-fuzzy evidence distinguishes it from a legitimate growth rewrite
without re-opening the partial-trusts-mapper adjudication. TEST-61's operative predicate
and FAIL-1's harm are cross-anchor; both are now clean. _(Round-3 note: the corrected
verdict showed this disclosure understated the remainder — the uncovered class was
per-anchor substitution at 12.6 %, not the rare superset. Closed by round 3 below.)_

### Round 3 — the substitution arm (evaluator FAIL-1: TEST-61 per-anchor; FAIL-2: TEST-67c)

**Implemented on: fable (claude-fable-5).** Round-3 corrected verdict: the round-2 guard's
scope was cross-anchor while TEST-61's invariant is per-anchor — an anchor handed **wholly
unrelated text** while its own exact survives verbatim and uniquely elsewhere (378/3006 =
12.6 % of swept anchors in wholly-distinct-text documents; pre-existing, byte-identical
pre-round-2). TEST-67(c) fails as a named instance: the anchor is handed the *inserted
filler* instead of following its moved sentence.

**Reproduction (before any code change), 2026-07-26.** All real runs, `tsx` drivers under
`/tmp/server012-r3/`, engine = repo HEAD (`46fa225`, pre-round-3):

- **Evaluator's hand-verified FAIL-1 fixture** rebuilt (six wholly-distinct paragraphs,
  swap #4 ↔ #6, one anchor on "Hiring is paused…"): `remapped`, emitted exact =
  `"Cash runway extends nineteen months under the current burn profile."`, resolves to
  `{217,284}` (the anchor's old byte offsets — matching the verdict byte-for-byte), own
  text surviving verbatim and uniquely at 353. `classify=partial`,
  `straddledByReplacement=false`, slice round-trips, no co-anchor — every existing guard
  blind by construction.
- **On disk** (`tsx repro-disk.mts`, real `git init` workspace
  `/var/folders/.../corpus-s012r3-F2vohs`, save-path shape, `git diff -U0`): frontmatter
  diff shows `exact:` flipping from the hiring paragraph to the cash-runway paragraph —
  the thread silently re-pointed at an unrelated paragraph.
- **TEST-67c, corrected predicate**: fixture search recovered the evaluator's exact shape
  (`opening "Opening remarks compare current lenders."`, closing
  `"Closing remarks on the tax treatments of points follow."`, fillers
  `"An inserted paragraph one/two."`): both variants `remapped` to the **inserted filler**
  (emitted `"An inserted paragraph one.\n\nAn inserted paragraph two."` resp.
  `"An inserted paragraph one."`) while the moved sentence survives uniquely — matching
  the verdict's emitted exacts character for character.
- **Independent 1000-case sweep** (wholly-distinct paragraph pool; shapes
  swap/rotate/shuffle/reverse/insert+relocate/delete-during-reorder; 1–4 anchors incl.
  single-anchor): **E (substitution) = 136/2495 anchors (5.5 %)**, concentrated in insert
  (55) and swap (50); A = B = C = 0 (round 2 holds).

**Adjudicated design refinement (orchestrator decision — refines, does not reverse, the
SERVER-002 partial-trusts-mapper pin):** *a rewritten slice with no kinship to its
original is not in-place-edit evidence.* `reconcileAnchors` voids a rewritten `partial`
slice when **both**: (1) its similarity to the original exact is below the engine's fuzzy
threshold (reusing `boundedLevenshtein` + `FUZZY_THRESHOLD = 0.75` — no new constants),
and (2) the original occurs verbatim in `newBody` outside the slice (an occurrence wholly
*inside* the slice is kinship by containment — the pinned superset residual never voids).
Voided slices re-place through the existing adjudicated chain (`verifiedSurvivor`:
exact-only rungs 1–2 + insertion-overlap, orphan last, fuzzy never, selector
byte-preserved on orphan). New third arm of the pass-1 `suspect` disjunction; `diff.ts`,
the cross-anchor pass, and every other seam untouched.

**Chain analysis verified before relying on it** (`tsx chain-verify.mts`, mapper probes):
a reorder-relocated survivor sits in INSERT text (`touchesInsertion=true` → re-attach; an
EQUAL survivor would have been *followed* by the monotone mapping and the slice would
equal the exact, never reaching the guard); a pre-existing doppelgänger under a
partial-classified unrelated rewrite sits wholly in EQUAL text (`touchesInsertion=false`
→ orphan; that case was itself a substitution at HEAD — remapped to the unrelated
replacement — so the remap→orphan change is inside the licensed class). No case found
where the chain misbehaves for a voided slice; no fifth adjudication needed.

**Post-fix verification** (all real runs, freshly rebuilt):

- FAIL-1 fixture: `remapped`, exact preserved byte-for-byte, resolves to `{353,421}` —
  its own paragraph's new home. On disk the frontmatter diff is context-only refresh.
- TEST-67c both variants: `remapped`, exact = the moved sentence, resolving to exactly
  the survivor's own range (`{175,227}` / `{147,199}` — the verdict's quoted offsets).
- Sweep: **E = 0/2495** (pre-fix 136); A = B = C = 0.
- **A/B vs the pre-round-3 snapshot** (`/tmp/server012-r3/prefix-anchors`,
  `ab-verify.mts` + `ab-sweep.mts`): 25-fixture must-hold battery **25/25
  byte-identical** — four deletion scenarios, escalating-context ×4 (TEST-26),
  cut-and-paste ×3, TEST-59/60 sibling family, both-siblings-deleted, re-typed re-attach,
  straddled doppelgänger, shrinks ×3, reversed near-identical reorder, capture-with-twin,
  musical-chairs identical paragraphs, genuine-deletion-during-reorder, nested exemption,
  shadowed-window, and must-hold (d) below. Sweep A/B: 864/1000 cases byte-identical;
  **all 136 differing cases contain a pre-fix substitution-class anchor; 0
  non-substitution anchors changed even inside differing cases**; outcome totals
  identical (remapped 2079 / orphaned 84 / unchanged 332 both engines — substituted
  anchors re-attach to their own text, none newly orphan in this family).
- **Must-hold (d)** — the original adjudication surviving: a heavy in-place edit *above*
  the threshold (similarity ≈ 0.87) with a verbatim duplicate elsewhere stays trusted —
  `remapped` to the edited slice, byte-identical to pre-round-3.
- Determinism ×200 → 1 distinct serialized result; deep-frozen inputs: no throw, distinct
  output. Purity grep over non-test anchor modules: zero hits.
- Perf A/B (same machine, same inputs): 1 MB/50 anchors middle insertion 7.2 ms vs
  7.6 ms pre; 1 MB distant-swap 8.5 vs 8.2; 1 MB all-50-anchored-paragraphs deleted 58.0
  vs 51.8 (+12 %, the guard never runs on `equal`/verbatim slices). Same order of
  magnitude everywhere.
- New tests (9): the swap fixture + kinship-seam fixture-rot guard (raw mapped slice =
  the other paragraph, partial, non-straddled), TEST-67c ×2 with mapped-slice-is-filler
  rot guards, partial-path doppelgänger orphan (with `touchesInsertion=false` pinned),
  must-hold (d), genuine-deletion-during-distinct-reorder, a 40-seed wholly-distinct
  reorder/insertion sweep, and a disk-matrix swap row. The substitution predicate
  (`expectNoSubstitution`) is asserted inside **all** property sweeps (random-edit,
  near-identical siblings, near-identical reorders, wholly-distinct).

**Repo gates** (round-3 final state): `npm run build` ✓ · `npm run lint` ✓ (0 problems) ·
`npm run format:check` ✓ · `npm run typecheck` ✓ (5 workspaces) · `npm test` **1693
passed / 85 files** (1684 baseline + 9 new, zero regressions) · coverage 99.56 % stmts /
96.29 % branches / 100 % functions (gate 90 %); `reconcile.ts` 100/100/100/100.

**Known residual (round 3, disclosed):** slices *within* the fuzzy threshold of their
original are still trusted even when the original survives elsewhere — that is must-hold
(d), the SERVER-002 adjudication itself. Concretely: a fixture variant of the 67c shape
where the diff keeps the moved sentence but misaligns its trailing period emits a 51-of-52
character selector (similarity ≈ 0.98, survivor overlapping the slice — the evaluator's
G class, 0/3006 in their sweep, fixture-sensitive); and the pinned single-anchor superset
shape (original surviving wholly inside a grown slice) is deliberately exempted from
voiding by the containment clause. Neither is reachable without re-opening (d).

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

### Round-3 revert (orchestrator, 2026-07-26)

Eval round 4 found `lacksKinship` regressive: 67.3% of shrink-edits-with-duplicate orphaned
(TEST-63 violation, new vs round 2) while 6.5% of plain swaps still substituted (median
similarity 0.924 — no threshold satisfies both tests). The round-3 code commit (4515fb9) is
reverted; the engine stands at the round-2 state the evaluator confirmed strictly improving
with zero regressions (capture 339→0, collision 114→0, substitution 695→378, all pre-existing).
The substitution class is escalated to the user per the 3-round cap; the candidate design for
the next attempt (unique-verbatim-survivor location/INSERT-vs-EQUAL discriminator) is recorded
in the eval file and server-dev Domain Knowledge.

### Re-scope (user decision, 2026-07-26)

Closed as done for the arms it fixed — slice truncation (round 1) and cross-anchor
capture/collision (round 2), both evaluator-verified strict improvements with zero
regressions. The remaining pre-existing substitution class (eval rounds 3–4) is carved
out to [SERVER-013], sequenced before SERVER-005 so the write path never consumes the
engine with it open. The round-3 similarity attempt stays reverted; the survivor-location
design authorized for SERVER-013 is recorded there and in the eval file.

### Cross-reference (2026-07-26)

SERVER-013 closed the carved-out substitution class with the authorized survivor-location
discriminator (relocation evidence: disjoint verbatim occurrence overlapping INSERT text →
void + re-place through the adjudicated chain; EQUAL survivor → mapper trust), plus an
exact-tier boundary repair for the 67c truncation. Both sweeps report substitution 0; every
round-1/round-2 outcome of this issue A/B'd byte-identical. Evidence: SERVER-013's E2E log.
