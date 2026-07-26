# Evaluation: SERVER-002

**Date**: 2026-07-26
**Sprint**: sprint-001 (Phase 1 — Foundations)
**Verdict**: FAIL (14 of 15 acceptance tests pass; TEST-26 fails — the M1 matrix's
context-only row)

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
