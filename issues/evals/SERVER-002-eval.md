# Evaluation: SERVER-002

**Date**: 2026-07-26
**Sprint**: sprint-001 (Phase 1 — Foundations)
**Verdict (round 3, commit 4296717)**: **PASS** — 15 of 15 acceptance tests pass. Both prior
defects are closed simultaneously, the new seam discriminates correctly under adversarial
probing, and no regression was found. See [Round 3](#round-3--re-evaluation-of-the-second-fix).
**Verdict (round 2, commit 8bafa07)**: FAIL — round-1's TEST-26 defect fixed, but deleting
anchored text re-attached its thread to *different* text.
**Verdict (round 1, commit 0515dc0)**: FAIL (14 of 15; TEST-26 failed)

Verification followed sprint-001's Verification Environment for SERVER-002: real markdown
files edited on real disk in a real `git init` scratch workspace, `git diff` as the
observation instrument, driven by the evaluator's own throwaway `tsx` scripts. No
implementation source was read to reach this verdict (the one exception, sanctioned by
TEST-28 itself, is a `grep` of `import` statements — required by that test).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, scenario by scenario, with reports, offsets, slices and `git diff` observations.                                                     |
| Commands are specific and concrete      | PASS   | Named script, named workspace, real reports (`{"unchanged":["anc_k4f7"],…}`), real offsets, measured `elapsed=5.2ms`.                        |
| Real E2E (not mocked)                   | PASS   | Real mkdtemp + `git init` workspace, 9 commits, frontmatter + body written back each round.                                                  |
| Scenarios cover acceptance criteria     | **FAIL** | TEST-26 — the only M1 row the log did **not** run on disk ("covered in the unit M1 matrix") — is the one that breaks. Its unit fixture changes fewer words than the contract's Given, so the defect never surfaced. TEST-27/28/30/31/32 were also unit-only; I re-ran all five for real and they pass. |
| Application restarted after changes     | PASS   | N/A for a pure library; every probe imported freshly built sources after `npm run build` from a clean tree.                                  |
| Actual model recorded (implemented on:) | PASS   | "implemented on: fable (claude-fable-5)", addendum "implemented on: opus".                                                                   |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. (The log does honestly record a fixture bug found mid-run and how it was fixed.)                                              |

## Criteria Results

| #       | Criterion                                          | Result   | Notes                                                                                                                                              |
| ------- | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-18 | Rung 1 — contextual exact wins                     | PASS     | 3 occurrences of `the rate`; the selector's prefix+exact+suffix picks the 2nd (contextual), not the first bare one.                                     |
| TEST-19 | Rung 2 — bare unique exact                         | PASS     | Range slices back to `exact`.                                                                                                                          |
| TEST-20 | Rung 3 — fuzzy on a lightly edited body            | PASS     | One-character corruption resolves to the edited sentence; 100 repeat calls → 1 distinct result.                                                         |
| TEST-21 | Rung 4 — orphan rather than guess; threshold       | PASS     | `FUZZY_THRESHOLD = 0.75`. Unrelated prose → `null`. Boundary from both sides: ~0.758 resolves, ~0.710 does not.                                         |
| TEST-22 | M1 — edit strictly before the range                | PASS     | `unchanged`; on-disk `exact` byte-identical; re-resolves to the same sentence; `git diff` shows only the two inserted body lines.                       |
| TEST-23 | M1 — edit strictly after the range                 | PASS     | `unchanged`; same offsets; `git diff` shows the appended body lines only; no anchor line touched.                                                       |
| TEST-24 | M1 — edit inside the range                         | PASS     | `remapped`; on-disk `exact` now quotes the edited sentence verbatim; re-resolves via rung 1/2. (The selector survives the YAML write byte-for-byte — verified by re-reading from disk.) |
| TEST-25 | M1 — the range is deleted                          | PASS     | `orphaned`; selector preserved byte-for-byte; `git diff` shows only the deleted body lines; nothing threw.                                              |
| TEST-26 | M1 — only the surrounding context changes          | **FAIL** | See FAIL-1. Reported `orphaned`, selector left stale — while the very same selector still resolves in the new body.                                     |
| TEST-27 | Reconciliation is deterministic                    | PASS     | 100 runs over a 20 KB body with 7 anchors (2 orphaning) → 1 distinct serialized result, bucket ordering included.                                       |
| TEST-28 | The engine is pure                                 | PASS     | Only `diff-match-patch`, sibling modules, and a **type-only** import from `@corpus/contract`. No `node:fs`, `node:child_process`, `better-sqlite3`, or `core/`. |
| TEST-29 | Bounded work on a large document                   | PASS     | 1,000,000-char body, 50 anchors, one mid-body insertion: **0.8 ms**. Harder control — 200 scattered edits: **20.5 ms**, all 50 anchors kept.            |
| TEST-30 | Unicode safety                                     | PASS     | ZWJ emoji sequences, combining marks, RTL: no lone surrogate in any emitted `exact`/`prefix`/`suffix`; ranges slice back to well-formed strings; context clipped between astral pairs correctly. |
| TEST-31 | Already-orphaned anchors never re-attached         | PASS     | Anchor unresolvable in `oldBody` whose text appears in `newBody` → `orphaned`, selector byte-identical.                                                 |
| TEST-32 | Reconciliation does not mutate its input           | PASS     | Caller mutating the result leaves the input deep-equal to its snapshot; returned map is a distinct object.                                              |
| TEST-64 | Emitted selectors agree with the wire contract     | PASS     | Anchor at body start (empty `prefix`) and anchor with no declared context both emit strings satisfying `TextQuoteSelectorSchema`.                       |
| TEST-62 | Composes with SERVER-001's checker                 | PASS     | `checkCorpus(docs, { resolveAnchor })` — property shorthand, no cast/adapter — `tsc --noEmit --strict` exit 0; the resolvable anchor resolves through rung 3 (case-differing body), so the real ladder is genuinely in play. |

## Failures

### FAIL-1: An untouched anchored range is reported orphaned when both its neighbours are rewritten

**Criterion**: TEST-26 ("The anchor is reported `remapped`; `exact` is unchanged; `prefix` and
`suffix` on disk now quote the **new** surroundings"). Also SPEC §6, reconciliation step 3:
"Range untouched by the edit → keep `exact`, recompute `prefix`/`suffix` from the new
surroundings" — and §6's promise that an orphaned thread means the anchored text is *gone*.

**Expected**: `report.remapped = ["anc_k4f7"]`, `exact` unchanged, `prefix`/`suffix`
refreshed to the new surroundings.

**Observed**: `report.orphaned = ["anc_k4f7"]` with the selector left completely stale — its
`prefix`/`suffix` still quote text that no longer exists in the document. The anchored
sentence is present in `newBody`, character for character, at offset 83. The engine's own
resolver contradicts its reconciler: `resolveAnchor(newBody, emittedSelector)` returns
`{"start":83,"end":135}`. Root cause is visible through the exported mapper —
`computeOffsetMapper(oldBody, newBody).classify(anchoredRange)` returns **`"deleted"`** for a
range whose text was never edited, because `diff_cleanupSemantic` merges the two neighbouring
rewrites into one delete/insert pair that swallows the untouched sentence between them.

Behaviourally: a user rewrites the paragraph above and the paragraph below a sentence, and the
thread hanging off that sentence silently detaches into "detached threads" even though its
text is untouched. That is precisely the failure mode reconciliation exists to prevent.

**Boundary** (same fixture, escalating context edits — first three are correct, the fourth is
the bug):

| edit                                       | exact still present | report      | context refreshed |
| ------------------------------------------ | ------------------- | ----------- | ----------------- |
| one word before changed                    | yes                 | `remapped`  | yes               |
| one word before + one after changed        | yes                 | `remapped`  | yes               |
| preceding sentence fully rewritten         | yes                 | `remapped`  | yes               |
| **both neighbouring sentences rewritten**  | **yes**             | **orphaned**| **no**            |

**Steps to reproduce** (pure library, no disk needed):

1. `cd /Users/theophanerupin/code/corpus`
2. Create `node_modules/.eval/repro26.ts`:
   ```ts
   import { reconcileAnchors, resolveAnchor, computeContext, computeOffsetMapper } from "@corpus/server";
   const SENT = "We assume a 30-year fixed at 6.1% for the base case.";
   const oldBody = `\n# Mortgage options\n\nThe finance model has three inputs that matter most.\n\n${SENT}\n\nEverything downstream depends on that number.\n`;
   const newBody = oldBody
     .replace("The finance model has three inputs that matter most.", "Completely different words now precede the quoted line here.")
     .replace("Everything downstream depends on that number.", "Utterly different words now follow the quoted line as well.");
   const s = oldBody.indexOf(SENT);
   const ctx = computeContext(oldBody, s, s + SENT.length);
   const selector = { exact: SENT, ...ctx };
   const res = reconcileAnchors(oldBody, newBody, { anc_k4f7: selector });
   console.log("exact still present:", newBody.includes(SENT));
   console.log("classify:", computeOffsetMapper(oldBody, newBody).classify({ start: s, end: s + SENT.length }));
   console.log("report:", JSON.stringify(res.report));
   console.log("resolves anyway:", JSON.stringify(resolveAnchor(newBody, res.anchors.anc_k4f7)));
   ```
3. `./node_modules/.bin/tsx node_modules/.eval/repro26.ts`
4. Observe:
   ```
   exact still present: true
   classify: deleted
   report: {"unchanged":[],"remapped":[],"orphaned":["anc_k4f7"]}
   resolves anyway: {"start":83,"end":135}
   ```

The same scenario run through the on-disk M1 driver (real workspace, `git diff` instrument)
reproduces identically: `report {"orphaned":["anc_k4f7"]}`, frontmatter untouched, both
neighbouring body lines changed.

## Observations (not failures)

- **1 MB CRLF conversion**: converting every line ending in a 1 MB body takes **1016 ms**,
  just over TEST-29's budget — but that budget is stated for "an edit", and this pathological
  whole-file rewrite is a documented edge case. Behaviour is correct (29 `unchanged`, 21
  `remapped`, **0 orphaned**); the cost is the configured `Diff_Timeout` degrading gracefully.
- **Written selector formatting**: when a reconciled selector reaches disk through
  SERVER-001's serializer, multi-line context is emitted as YAML block scalars
  (`prefix: |+`). Ugly, but I verified it re-reads byte-identically and still resolves, so it
  is cosmetic. Attribution belongs to SERVER-001's serializer, not this engine.

## Summary

14 of 15 acceptance tests pass, and the engine is genuinely good on the hard parts — the
ladder is deterministic and correctly ordered, purity holds, unicode never splits a surrogate,
1 MB/50 anchors runs in under a millisecond, already-orphaned anchors are never re-attached,
and inputs are never mutated. The one failure is in the M1 matrix — the acceptance suite this
issue exists to satisfy — and it is a false orphan, the worst class of error here: the system
reports a thread detached from text that never changed.

**Verdict: FAIL** — fix FAIL-1 (classification must not call a range deleted when its
characters survive verbatim in the new body) and re-verify TEST-26 **on disk**, with the
contract's Given (both neighbouring sentences rewritten), not a one-word unit fixture.

---

# Round 2 — re-evaluation of the fix

**Date**: 2026-07-26
**Commit under test**: `8bafa07 [SERVER-002] Fix false orphan: verify deleted-claims via §6 re-resolution`
**Verdict**: **FAIL** — round-1 FAIL-1 is fixed; a new, more severe defect is introduced.

Claimed fix: a `deleted` classification from the offset mapper is now treated as a claim,
verified by re-resolving the original selector through the §6 ladder before orphaning;
partial ranges still trust the mapper.

## 1. The round-1 failure is fixed

Re-ran my exact round-1 probes.

**Minimal repro** (both neighbouring sentences rewritten, anchored sentence untouched):

```
exact still present in newBody: true
mapper.classify(anchored range): deleted        <- mapper still says deleted
report: {"unchanged":[],"remapped":["anc_k4f7"],"orphaned":[]}
emitted prefix: " precede the quoted line here.\n\n"
emitted suffix: "\n\nUtterly different words now fo"
```

The emitted selector is now **exactly** the SPEC §6 step-3 expectation
(`computeContext(newBody, …)`), and it resolves at `{"start":83,"end":135}`.

**Escalating-context sequence** — all four rows now `remapped` with refreshed context, where
round 1 orphaned the fourth:

| edit                                      | round 1     | round 2    | context refreshed |
| ----------------------------------------- | ----------- | ---------- | ----------------- |
| one word before changed                   | `remapped`  | `remapped` | yes               |
| one word before + one after changed       | `remapped`  | `remapped` | yes               |
| preceding sentence fully rewritten        | `remapped`  | `remapped` | yes               |
| **both neighbouring sentences rewritten** | `orphaned`  | `remapped` | **yes**           |

**On-disk M1 matrix** (real workspace, `git diff` instrument): TEST-22 `unchanged` with no
frontmatter change · TEST-23 `unchanged` · TEST-24 `remapped`, `exact` = the edited sentence ·
TEST-25 `orphaned`, selector preserved, body-only diff · **TEST-26 `remapped`**, `exact`
unchanged, `prefix`/`suffix` now quoting the new surroundings, each ≤ 32 chars. All five rows
pass.

**A/B against the pre-fix engine** (pre-fix `apps/server/src/anchors/` extracted from
`0515dc0` and imported as a black box, same inputs):

```
[TEST-26 @ PRE-FIX] report: {"orphaned":["anc_k4f7"]}
[TEST-26 @ HEAD   ] report: {"remapped":["anc_k4f7"]}
```

## 2. FAIL-2 (new): deleting anchored text re-attaches its thread to different text

**Criterion**: SPEC §6 reconciliation step 5 — "Range entirely deleted → the anchor keeps its
last selector (for history/git) and its thread becomes orphaned"; sprint TEST-25 — "the anchor
is reported `orphaned`; `git diff` shows **no change whatsoever** to that anchor's frontmatter
block — the last selector is preserved byte-for-byte for history". Also the issue's own Edge
Cases: "fuzzy must not 'find' spurious matches".

**What the fix did wrong**: verifying the `deleted` claim by re-running the **full** §6 ladder
means rung 3 (fuzzy, threshold 0.75) is in play. A deleted paragraph that has a *similar
sibling* anywhere in the document is therefore "verified" as still present, silently
re-attached to the sibling, and its historical selector is **overwritten**.

**The most realistic case — a deleted list item.** The user deletes the *bread* bullet from a
shopping list; the thread hanging off it now points at *milk*:

```
$ tsx node_modules/.eval/s2-t25.ts
The user deleted the BREAD bullet. Its thread should orphan.
report: {"unchanged":[],"remapped":["anc_bread1"],"orphaned":[]}
selector now on disk: {"exact":"\n- Buy milk from the corner store on Tuesday.", …}
frontmatter rewritten: true
--- git diff -U0 (TEST-25 requires NO change to the anchor block) ---
   -    exact: "- Buy bread from the corner store on Tuesday."
   -    prefix: "om the corner store on Tuesday.\n"
   -    suffix: "\n- Buy eggs from the corner stor"
   +    exact: |-
   +
   +      - Buy milk from the corner store on Tuesday.
   +    prefix: |
   …
   -- Buy bread from the corner store on Tuesday.
the thread now points at: "\n- Buy milk from the corner store on Tuesday."
```

**A/B — this is unambiguously new**, same inputs against the pre-fix engine:

| scenario                                                        | PRE-FIX (`0515dc0`)                    | HEAD (`8bafa07`)                                       |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| delete the middle of three similar paragraphs                   | `orphaned`, selector preserved = true  | **`remapped`** onto the *alpha* paragraph's text        |
| delete the middle bullet of a 3-bullet list                     | `orphaned`, selector preserved = true  | **`remapped`** onto the *milk* bullet                   |
| delete the `Q2` row of a 3-row table                            | `orphaned`, selector preserved = true  | **`remapped`** onto the `Q3` row                        |
| delete an anchored sentence that has a verbatim copy elsewhere  | `orphaned`, selector preserved = true  | **`remapped`** onto the copy                            |

**Consequences**

1. A thread silently attaches to content its author never commented on — worse than orphaning,
   because orphaning is visible ("detached threads" per §6) while this is invisible and wrong.
2. The historical selector is destroyed in git, defeating the explicit purpose of §6 step 5.
3. TEST-25 still passes only because the sprint's fixture — and the new
   `reconcile.disk.test.ts` — use a document with a single anchor and no similar text.

**Steps to reproduce** (pure library):

1. `cd /Users/theophanerupin/code/corpus`
2. Create `node_modules/.eval/repro-fail2.ts`:
   ```ts
   import { reconcileAnchors, computeContext } from "@corpus/server";
   const P = (n: string) => `The ${n} paragraph discusses ${n} matters and nothing else whatsoever.`;
   const oldBody = `\n# Doc\n\n${["alpha", "bravo", "charlie"].map(P).join("\n\n")}\n`;
   const newBody = oldBody.replace(P("bravo") + "\n\n", "");     // the user deletes bravo
   const at = oldBody.indexOf(P("bravo"));
   const sel = { exact: P("bravo"), ...computeContext(oldBody, at, at + P("bravo").length) };
   const res = reconcileAnchors(oldBody, newBody, { anc_bravox: sel });
   console.log(JSON.stringify(res.report));
   console.log("selector preserved:", JSON.stringify(res.anchors.anc_bravox) === JSON.stringify(sel));
   console.log("now quotes:", JSON.stringify(res.anchors.anc_bravox.exact));
   ```
3. `./node_modules/.bin/tsx node_modules/.eval/repro-fail2.ts`
4. Observe:
   ```
   {"unchanged":["anc_charlx"],"remapped":["anc_alphax","anc_bravox"],"orphaned":[]}
   selector preserved: false
   now quotes: "The alpha paragraph discusses alpha matters and nothing else whatsoever."
   ```
   Expected: `anc_bravox` in `orphaned`, selector preserved, `exact` unchanged.

**Direction** (behavioral, not prescriptive): the round-1 case is one where the anchored text
survives **verbatim** — rungs 1–2 alone would have verified it. The verification step reaching
rung 3 is what re-attaches deleted text to look-alikes.

## 3. Everything else still holds

| Probe                                                       | Result                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Genuine deletion, neighbours untouched                      | PASS — `orphaned`, selector preserved                                                      |
| Genuine deletion + both neighbours rewritten                | PASS — `orphaned`, selector preserved                                                      |
| Whole body replaced with unrelated prose                    | PASS — `orphaned`                                                                          |
| Body emptied                                                | PASS — `orphaned`, no throw                                                                |
| Range edited down to whitespace                             | PASS — `orphaned`, treated as deleted                                                      |
| Duplicates elsewhere must not steal an in-place-edited anchor | PASS — remaps onto the edited first occurrence, not the untouched appendix copy           |
| Two identical sentences, context-only edit                  | PASS — each anchor resolves to its own occurrence (first→first, second→second)              |
| TEST-31 already-orphaned never re-attached                  | PASS — `orphaned`, selector byte-identical                                                 |
| TEST-18/19/20/21 ladder + threshold from both sides         | PASS — unchanged (0.758 resolves, 0.710 does not)                                          |
| TEST-27 determinism ×100 (incl. a 5-anchor mixed-outcome doc) | PASS — 1 distinct serialized result                                                       |
| TEST-28 purity                                              | PASS — imports unchanged: `diff-match-patch`, siblings, type-only contract                 |
| TEST-29 perf                                                | PASS — 1 MB / 50 anchors **0.9 ms** (round 1: 0.8 ms); 200 scattered edits **21.7 ms** (21.5 ms). Same order of magnitude. |
| TEST-30 unicode safety                                      | PASS — no lone surrogates, ranges slice back well-formed                                   |
| TEST-32 input immutability                                  | PASS — input deep-equal to snapshot, distinct object returned                              |
| TEST-64 contract selectors                                  | PASS — boundary anchors emit contract-valid selectors                                      |
| TEST-62 composition with the checker                        | PASS — no adapter, `tsc --strict` clean                                                    |
| Repo gates                                                  | PASS — lint, format:check, typecheck, **807 tests / 55 files**, coverage 99.76% / 95.48% / 100% |

**Note on the new `reconcile.disk.test.ts`**: it does run the M1 rows on disk, which is the
right instinct, but its TEST-25 row uses a single-anchor document with no similar text — the
same blind spot as the sprint fixture — so it cannot catch FAIL-2.

## Round-2 summary

The fix is directionally right and closes round-1's false orphan cleanly, with the on-disk M1
matrix now fully green and no measurable cost in determinism, purity or performance. But
verifying the mapper's `deleted` claim through the *whole* §6 ladder trades a false orphan for
a false attachment: any deleted paragraph, bullet or table row with a similar sibling — the
common case in real documents — is now re-attached to the wrong text and its historical
selector overwritten, violating SPEC §6 step 5 and the letter of TEST-25. A false orphan is
visible and recoverable; a silent misattachment is neither.

**Verdict: FAIL** — fix FAIL-2, and re-verify TEST-25 with a fixture that contains a
**similar sibling** (a list of near-identical bullets is the cheapest one), on disk, asserting
both the `orphaned` bucket and a `git diff` with no change to the anchor block.

---

# Round 3 — re-evaluation of the second fix

**Date**: 2026-07-26
**Commit under test**: `4296717 [SERVER-002] Deleted-claim verification is exact-only + insertion-overlap`
**Verdict**: **PASS** (15 of 15)

Shipped design: a `deleted` claim from the offset mapper re-attaches only when
`resolveAnchorExact` (rungs 1–2, never fuzzy) finds the text in `newBody` **and** the match
overlaps text this edit inserted (`OffsetMapper.touchesInsertion`); an exact match lying wholly
inside unedited text is a pre-existing doppelgänger and orphans with the selector byte-identical.

## 1. Round-2 FAIL-2 is fixed

The four A/B scenarios that failed in round 2, re-run against the pre-fix engine (`0515dc0`,
extracted and imported as a black box) and HEAD:

| scenario                                                       | PRE-FIX                | round 2                     | round 3 (HEAD)         |
| --------------------------------------------------------------- | ---------------------- | --------------------------- | ---------------------- |
| delete the middle of three similar paragraphs                   | `orphaned`, preserved  | `remapped` onto *alpha*     | **`orphaned`, preserved** |
| delete the middle bullet of a 3-bullet list                     | `orphaned`, preserved  | `remapped` onto *milk*      | **`orphaned`, preserved** |
| delete the `Q2` row of a 3-row table                            | `orphaned`, preserved  | `remapped` onto `Q3`        | **`orphaned`, preserved** |
| delete anchored text having a verbatim copy elsewhere           | `orphaned`, preserved  | `remapped` onto the copy    | **`orphaned`, preserved** |

**My round-2 retest guidance, executed exactly** — TEST-25 with a similar sibling present, on
disk, real git:

```
$ tsx node_modules/.eval/s2-t25.ts
The user deleted the BREAD bullet. Its thread should orphan.
report: {"unchanged":[],"remapped":[],"orphaned":["anc_bread1"]}
selector now on disk: {"exact":"- Buy bread from the corner store on Tuesday.", …}   # byte-identical
frontmatter rewritten: false
--- git diff -U0 (TEST-25 requires NO change to the anchor block) ---
   -- Buy bread from the corner store on Tuesday.
```

Body-only diff, anchor block untouched, selector preserved byte-for-byte. This is exactly what
TEST-25 demands and what round 2 violated.

## 2. Round-1 FAIL-1 stays fixed

TEST-26 minimal repro: `{"remapped":["anc_k4f7"]}` with `prefix`/`suffix` equal to
`computeContext(newBody, …)`. Escalating-context sequence — all four rows `remapped` with
refreshed context, including "both neighbouring sentences fully rewritten". On-disk M1 matrix:
TEST-22 `unchanged` (no frontmatter change) · TEST-23 `unchanged` · TEST-24 `remapped` with
`exact` = the edited sentence · TEST-25 `orphaned` with a body-only diff · TEST-26 `remapped`
with `exact` unchanged and context quoting the new surroundings. **Both defects are closed at
once** — the two are no longer in tension.

## 3. The seam does what it says

Reading the decision inputs directly through the exported API:

| case                                                     | `classify` | `resolveAnchorExact` | `touchesInsertion` | outcome                |
| ---------------------------------------------------------- | ---------- | -------------------- | ------------------ | ---------------------- |
| TEST-26 (neighbours rewritten; anchor sits inside the diff's inserted run) | `deleted`  | `{68,120}`           | **true**           | `remapped` ✓            |
| doppelgänger (twin pre-existed in untouched text)        | `deleted`  | `{108,160}`          | **false**          | `orphaned`, preserved ✓ |
| plain deletion, no twin anywhere                         | `deleted`  | `null`               | —                  | `orphaned`, preserved ✓ |

The discrimination is principled rather than incidental: identical classification, identical
exact-hit, opposite verdicts, decided solely by whether the surviving text is text this edit
produced.

**`resolveAnchorExact` is genuinely fuzzy-free**: on a body one character off it returns
`null` while the full ladder returns `{8,78}`; rung-1 contextual disambiguation still works
(3 occurrences of `the rate`, contextual selector → `{31,39}`); an ambiguous bare `exact`
(3 occurrences, no context) → `null`, i.e. rung 2's uniqueness requirement is intact.

## 4. Adversarial probing of the new seam

| probe                                                             | observed                                                                 | judgment |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| **Cut-and-paste**: anchored sentence moved down past the tail       | `remapped`, resolves to the moved text                                    | Correct — the thread follows its text, per §6's intent |
| Cut-and-paste: moved up above the lead                              | `remapped`                                                                | Correct |
| Cut-and-paste: moved far, extra paragraphs inserted between         | `remapped`                                                                | Correct |
| **Copy while the original is KEPT** (copy appended)                 | `unchanged`, selector preserved, resolves to the **original**             | Correct — the anchor must not drift to a copy |
| Copy while the original is kept (copy prepended)                    | `unchanged`, resolves to the original                                     | Correct |
| **Delete here + identical text inserted in an unrelated section**   | `remapped` onto the inserted copy                                         | Acceptable — see note below |
| Delete here + identical text inserted far away amid much new text   | `remapped` onto the inserted copy                                         | Acceptable — same reasoning |
| Insertion immediately **before** the anchored text                  | `remapped`, context refreshed                                             | Correct |
| Insertion immediately **after** the anchored text                   | `remapped`, context refreshed                                             | Correct |
| Whole-document reshuffle (all three paragraphs reordered)           | `remapped`, resolves to the anchored text                                 | Correct |
| Suffix-context-only edit, match wholly in unedited text             | `remapped` with `exact` kept (my probe's "expected `unchanged`" was wrong — the context did change, so `remapped` is the specified outcome) | Correct |
| Genuine deletion, no twin                                           | `orphaned`, preserved                                                     | Correct |
| Whole body replaced with unrelated prose                            | `orphaned`, preserved                                                     | Correct |
| Body emptied                                                        | `orphaned`, preserved                                                     | Correct |
| Anchored range edited down to whitespace                            | `orphaned`, preserved                                                     | Correct |

**Note on "delete here + identical text inserted elsewhere".** The diff aligns the two runs and
reports `equal`, so this never reaches the new seam at all — and it is byte-identical to the
pre-fix engine (A/B confirmed). It is also inherent to diffing: a move and a
delete-plus-coincidentally-retype are the same edit at the character level, and treating them
as a move is what makes cut-and-paste work. §6 does not distinguish them. Not a defect.

**Attribution check.** Most seam probes above run through `equal`/`partial`, not the
`deleted` path. I A/B'd each against the pre-fix engine: **cut-and-paste, copy-with-original-kept,
delete-plus-insert-elsewhere and whole-document reshuffle are byte-identical to pre-fix.** The
fix changed only the `deleted` branch, exactly as claimed.

## 5. Regression sweep — nothing moved

| Probe                                                            | Result                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| TEST-18/19/20/21 ladder, threshold from both sides               | PASS — 0.758 resolves, 0.710 does not; fuzzy deterministic over 100 calls        |
| TEST-22…26 on disk (M1 matrix, `git diff` instrument)            | PASS — all five rows                                                             |
| TEST-27 determinism ×100 (7 anchors incl. 2 orphaning); ×100 on a 5-anchor mixed-outcome doc; ×50 on a 1 MB body | PASS — 1 distinct serialized result in every case |
| TEST-28 purity                                                   | PASS — imports unchanged: `diff-match-patch`, relative siblings, one **type-only** `@corpus/contract` import |
| TEST-29 perf                                                     | PASS — 1 MB / 50 anchors **0.8 ms**; see §6                                      |
| TEST-30 unicode safety                                           | PASS — no lone surrogates; astral-adjacent context clipped correctly              |
| TEST-31 already-orphaned never re-attached                       | PASS — `orphaned`, selector byte-identical                                       |
| TEST-32 input immutability                                       | PASS — input deep-equal to snapshot (also verified at 1 MB / 50 anchors); distinct object |
| TEST-64 contract selectors                                       | PASS — boundary anchors emit contract-valid selectors                            |
| TEST-62 composition with the checker                             | PASS — property shorthand, no adapter                                            |
| Duplicates must not steal an in-place-edited anchor              | PASS — remaps onto the edited occurrence, not the untouched twin                 |
| Two identical sentences, context-only edit                       | PASS — first→first, second→second                                                |
| Repo gates                                                       | PASS — lint, format:check, typecheck (0 TS errors), **822 tests / 55 files**, coverage 99.76% lines / 95.58% branches / 100% functions; `npm run e2e` 13 passed |

## 6. Performance — direction verified, headline figure not reproduced

A/B, same inputs, both engines:

| scenario                                                   | PRE-FIX  | HEAD     |
| ------------------------------------------------------------ | -------- | -------- |
| 1 MB, 50 anchors, one paragraph inserted mid-body           | 2 ms     | **1 ms** |
| 1 MB, 50 anchors, body replaced with unrelated prose (all orphan) | 1001 ms  | 1011 ms  |
| 1 MB, 50 anchors, whole-body CRLF conversion                | 972 ms   | **771 ms** |
| 418 KB, 50 anchored paragraphs all genuinely deleted        | 17 ms    | **16 ms** |

Perf is non-regressive and improves on two of four. I could **not** reproduce the commit's
claimed "all-orphan worst case 1080 → 134 ms": my all-orphan construction is dominated by
`diff_main` hitting the configured 1 s `Diff_Timeout` in *both* engines, so the per-anchor
saving is invisible there. The claim may hold for a differently-shaped fixture; what I can
attest is the direction — no scenario got slower by more than measurement noise.

## 7. Observations for the orchestrator (not verdict-changing)

1. **Render-time resolution can still land on a look-alike.** Reconciliation now correctly
   orphans the deleted bread bullet and preserves its selector — but `resolveAnchor` (the
   §6 ladder, rung 3 included) applied to that preserved selector against the new body still
   returns the *milk* bullet. So SERVER-004's `anchors.resolved_offset` will be non-null and
   the UI may render the orphaned thread anchored to the wrong bullet. This is pre-existing
   (identical on the pre-fix engine) and §6 explicitly prescribes fuzzy as resolution rung 3,
   so it is not a SERVER-002 defect — but the reconciler's history guarantee is only as good
   as what the projection does with it. Worth a decision before SERVER-004.
2. **Pre-existing `partial`-path oddity.** When a paragraph is deleted next to a
   near-identical paragraph that is *also* edited, the mapper's `partial` alignment can emit
   truncated selectors (`exact: "Paragraph one now"`) and hand one anchor another
   paragraph's text. A/B confirms this is byte-identical on the pre-fix engine — untouched by
   both fixes and outside the M1 matrix — but it is the same family of problem and deserves
   its own issue rather than being forgotten.

## Round-3 summary

The second fix closes round-2's misattachment without reopening round-1's false orphan — the
hard part, since the two pull in opposite directions. The discriminator is the right one:
exact-only verification means fuzzy can never manufacture a re-attachment, and the
insertion-overlap test distinguishes "this text is here because the edit put it here" from
"this text was already there", which is exactly the difference between a moved anchor and a
doppelgänger. I probed that seam with cut-and-paste, copy-with-original-retained,
delete-plus-paste-elsewhere, adjacent insertions and a whole-document reshuffle, and A/B'd
every case against the pre-fix engine to make sure nothing else shifted; determinism, purity,
immutability, unicode safety and performance all hold.

**Verdict: PASS.**
