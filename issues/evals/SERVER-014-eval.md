# Evaluation: SERVER-014

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

Scope: `issues/server/014-duplicate-survivor-policy.md` against sprint-008 TEST-77…TEST-85, plus the
reassigned TEST-110/TEST-111 (SERVER-022 finding 4, per Open Conflict 9). Evaluated at
`phase-3-ui` tip `4ea3e4b`; the issue's own commit is `389208e`. Behavioral evidence only — the
engine was exercised as a library and through a real `corpus init` server on port **8973**; no
application source was read except the diff `abb6b48..4ea3e4b -- apps/server/src/anchors/`, which
TEST-81 requires.

## E2E Proof-of-Work Audit

| Check                                     | Result | Notes                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                  | PASS   | Issue lines 132–234: reproduction section, post-implementation verification, fast-path proof, adjudication sweep, real-server disk pass. Not a checkbox recital.                                                                                                          |
| Commands specific and concrete            | PASS   | Named commands (`git show HEAD:…`, `vitest run apps/server/src/anchors`, `corpus init --port 8925`, `PUT /api/docs/doc_td2xnp7o`), named ids, quoted verbatim outputs, stated scratch path and pid.                                                                        |
| Real E2E (not mocked)                     | PASS   | Section "Real-server disk pass" runs a real `corpus init` workspace, a real daemon, real `POST /api/docs` + `POST /api/threads` + `PUT /api/docs/{id}`, and reads the `anchors:` map off disk and out of `git diff`. I reproduced the same pass independently on 8973.      |
| Scenarios cover acceptance criteria       | PASS   | AC1 rationale (§6-cited, lines 42–91), AC2 named fast-path test (verified present and passing), AC3 must-hold suites (verified: 70/70 in `reconcile.test.ts`, 2046/2046 in `apps/server`).                                                                                 |
| Application restarted after changes       | PASS   | The disk pass starts a fresh daemon (`corpus server start`, pid 7851) after the change and stops it by pid; ports verified free. My independent run confirms the shipped binary behaves as logged.                                                                        |
| Actual model recorded (`implemented on:`) | PASS   | "**Implemented on: fable**" at issue line 136, and `implemented on: fable` in commit `389208e`'s message. Matches the sprint's **fable** recommendation for SERVER-014.                                                                                                    |
| Reproduction logged before fix            | PASS   | Two fixtures logged at HEAD (`de47882`) before any change, via a byte-for-byte restore of the pre-change engine, with baseline≡current stated for the policy fixture and baseline≠current for the whitespace fixture. I re-derived fixture 1 exactly (see next section).   |

## Log Honesty Re-derivation

Independent script (`/tmp/corpus-e008-s014-eKCc4Q/repro.ts`) importing `reconcileAnchors`,
`resolveAnchor`, `resolveAnchorExact`, `computeOffsetMapper`, `computeContext` from the workspace
package and running the 4-step reproduction with the **shipped named test's exact bytes**.

| Claim in log                                                                    | Re-derived? | Actual observation                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B occurrences in newBody: [82,225]` (count 2; once in `oldBody`)                | YES         | `B occurrences in oldBody: [75]`; `B occurrences in newBody: [82,225]` — identical.                                                                                             |
| `classification of B's old range: equal`                                        | YES         | `oldRange {"start":75,"end":148}`, `classify → "equal"`.                                                                                                                        |
| `mapped slice === B: true {"start":82,"end":155}`                               | YES         | `mapped {"start":82,"end":155}`, slice byte-equal to `B`.                                                                                                                        |
| `resolveAnchorExact(newBody, old selector): null`                               | YES         | `null` — the uniqueness chain would have orphaned.                                                                                                                              |
| `report={"unchanged":[],"remapped":["anc_b"],"orphaned":[]}`                     | YES         | Exactly that.                                                                                                                                                                    |
| `resolved={"start":82,"end":155} exactPreserved=true prefixPreserved=false suffixPreserved=false` | YES | `resolveAnchor(newBody, emitted) = {"start":82,"end":155}`; emitted `exact` byte-identical, `prefix` `"on paths for the on-call rota.\n\n"`, `suffix` `"\n\nAlpha section covers onboardin"`. |
| "Same report shape as the evaluator's record … the finding has not moved"       | YES         | See below — the eval's `[263,348]`/prefix-preserved shape is reproducible; only the fixture's bytes differ.                                                                       |
| `it(…TEST-64)` fixture exercises `"deleted"`, the new fixture exercises `equal`  | YES         | Confirmed structurally (classification `equal`, mapped slice byte-equal, `resolveAnchorExact` null yet the engine remapped ⇒ only the fast path can have produced that outcome). |
| Post-change suite: 64 pre-existing `reconcile.test.ts` tests unmodified + 6 new  | YES         | `reconcile.test.ts` now 70/70 pass; the 6 new are the 2 duplicate-survivor + 4 whitespace-gate tests, visible in the diff as additions only.                                     |
| `apps/server`: 103 files / 1968 tests pass                                      | YES (grown) | At tip `4ea3e4b`: **105 files, 2046 tests, all pass** — the delta is later commits in the sprint, not a discrepancy in this issue.                                               |
| "No similarity constant entered the engine"                                     | YES         | Production hunk is 9 lines (8 comment + one gate); grep of added lines for `similar\|fuzzy\|score\|ratio\|threshold\|leven\|float literal` → **0 matches**.                       |
| "`git diff` over `packages/contract` is empty"                                  | YES (scoped) | `git show --stat 389208e -- packages/contract` → **empty**. (Over the whole sprint range `abb6b48..4ea3e4b` `packages/contract` is not empty, but every hunk belongs to CONTRACT-007/009 and SERVER-023, not to SERVER-014.) |
| Whitespace-only anchor refused at `POST /api/threads` with 400                   | YES         | Real server: `{"code":"bad_request","message":"an anchor needs the text it quotes","issues":[{"path":"selector.exact","message":"must contain at least one non-whitespace character"}]}` HTTP 400. |

**On the offsets differing from `SERVER-013-eval.md`** (the one thing TEST-77 says to treat as a
finding if it moved). The eval recorded offsets 87/263 and `resolveAnchor` at `[263, 348]` with
`prefix` byte-preserved; the issue's fixture yields 82/225 and `[82, 155]` with `prefix` rewritten.
The issue disclosed this ("My diff alignment picks the first occurrence (after C) where the
evaluator's strings aligned after A"). I tested whether that is a behavior change or a fixture
change by building a second fixture whose paragraph lengths match the eval's implied geometry
(A=79, B=75, C=75 vs the eval's 87/85/85 — same ordering relationship):

```
===== FIXTURE II — eval-offset-matched attempt =====
B occurrences in newBody: [77,235]
classification: equal
mapped: {"start":235,"end":310} mapped slice === B: true
resolveAnchorExact(newBody, old selector): null
report: {"unchanged":[],"remapped":["anc_b"],"orphaned":[]}
resolveAnchor(newBody, emitted): {"start":235,"end":310}
exactPreserved: true prefixPreserved: true suffixPreserved: false
```

That is the eval's exact shape — **second** occurrence chosen, `exact` and `prefix` preserved,
`suffix` rewritten. So the engine's behavior has not moved since SERVER-013; which of the two
verbatim occurrences the diff aligns onto is a function of the paragraph bytes, which is precisely
the "mapper's positional choice" the blessing is about. The log's disclosure is honest and the
finding is unmoved. **No finding.**

## Criteria Results

| #   | Criterion                                                | Result | Notes                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 77  | Reproduction runs first and is logged                     | PASS   | Logged verbatim at HEAD `de47882` before any change, via a byte-for-byte restore of the pre-change engine run A/B against the worktree. Every quoted value re-derived by me and identical (table above). Offset difference vs the SERVER-013 record is a fixture-bytes difference, reproduced and disposed of above.             |
| 78  | Policy decided in writing against §6 as amended           | PASS   | Issue lines 42–73 name **option (a)**, quote three §6 sentences that I verified verbatim in `SPEC.md:208–210`, argue B's text is not "genuinely gone" because it is *doubly present*, and argue a rewritten `suffix` on a **remap** is not a byte-preservation violation because that promise is scoped to orphans (`SPEC.md:209`). |
| 79  | One-sentence causal rule reconciling both shipped tests   | PASS   | Issue lines 75–83: "the uniqueness rules run only when the engine has lost the anchor's own bytes and must *prove* survival — a `"deleted"` classification or an impeached slice — whereas a mapped slice byte-identical to the `exact` is the edit itself demonstrating where the text went." It then applies the rule to both shipped fixtures. |
| 80  | Named test covers the FAST PATH                           | PASS   | New describe `duplicate-survivor fast path: the mapper's causal choice is blessed (SERVER-014)` with 2 tests, using the TEST-77 fixture. Genuinely distinct from the pre-existing `"deleted"`-path test — both run and pass separately (evidence below). Path claim independently corroborated, not merely asserted. One shortfall on demonstration form, recorded as OBS-1. |
| 81  | No similarity threshold entered the engine                | PASS   | `git diff abb6b48..4ea3e4b -- apps/server/src/anchors/reconcile.ts`: one production hunk, `+9/-1`, of which 8 lines are comment and 1 is `const blank = classification === "partial" && isBlank(mapped);`. Grep of added lines for `similar/fuzzy/score/ratio/threshold/leven` and float literals: **0 matches**.                    |
| 82  | Five closed adjudications' must-hold suites byte-identical | PASS   | `reconcile.test.ts` 70/70 pass with all 64 pre-existing tests unmodified (diff shows additions only, plus an unrelated perf-budget edit from a later commit). Full `apps/server`: **105 files / 2046 tests / 0 failures**. Seeded property-sweep suite passes (3/3). A/B-form shortfall recorded as OBS-2.                          |
| 83  | TEST-65 and the 68c corner re-verified                     | PASS   | `-t "true duplication during a reorder leaves the mapper's choice standing"` → 1 passed. `-t "EQUAL-text survivor"` → 1 passed (repo-wide run resolves it in `reconcile.test.ts`). Both unmodified in the diff.                                                                                                                    |
| 84  | Disk pass confirms the library result                      | PASS   | Reproduced independently end-to-end on 8973 (transcript below): response `{"remapped":["anc_e0d88019"],"orphaned":[]}`, on-disk `exact` byte-identical with `prefix`/`suffix` refreshed, `git diff HEAD~1 HEAD` shows both in the same auto-commit, and `GET /api/docs/{id}` reports `range {"start":82,"end":155}, orphaned:false` — the library's mapped range exactly. Thread renders inline, per the blessed policy. |
| 85  | Correction lands where the wrong expectation lived         | PASS   | Issue lines 85–91 correct the record and name sprint-004's TEST-64 *criterion text* (not the shipped test) as where the stale expectation lived. `.claude/agents/server-dev.md:45` carries a dated **2026-07-27** Domain Knowledge entry stating the rule, the causal sentence, why both shipped tests are simultaneously correct, and the companion whitespace gate. |
| 110 | Untouched save does not orphan a whitespace-only anchor    | PASS   | Real server: whitespace anchor seeded out-of-band (the mint path correctly refuses it, 400), then `PUT /api/docs/doc_6oik4mhw` editing only the tail paragraph → `anchors: {"remapped":[],"orphaned":[]}`, selector on disk byte-unchanged (`exact: "   "`, prefix/suffix intact), `orphaned:false` with `range {"start":18,"end":21}`. |
| 111 | Guard still fires where it should; no contract change       | PASS   | Both directions on the real server: deleting the whitespace's own text → `{"remapped":[],"orphaned":["anc_9523f6e1"]}` with the selector byte-preserved (`range:null, orphaned:true`); shrinking `"   "` → `" "` (partial) → `{"remapped":[],"orphaned":["anc_86ee2b29"]}`, selector preserved. `git show --stat 389208e -- packages/contract` is **empty**. |

**11 of 11 criteria PASS.**

### TEST-80 evidence (the sharpest criterion)

The new test is present, named, and uses the TEST-77 fixture verbatim:

```
$ npx vitest run apps/server/src/anchors/reconcile.test.ts -t "evaluator's 4-step reproduction"
 ✓ apps/server/src/anchors/reconcile.test.ts (70 tests | 69 skipped) 6ms
      Tests  1 passed | 69 skipped (70)

$ npx vitest run apps/server/src/anchors/reconcile.test.ts -t "probe: the fixture exercises the trusted-slice fast path"
      Tests  1 passed | 69 skipped (70)

$ npx vitest run apps/server/src/anchors/reconcile.test.ts -t "a non-unique survivor goes through the chain's uniqueness rules"
      Tests  1 passed | 69 skipped (70)
```

The two are genuinely distinct, and not merely by name. The pre-existing `it(…TEST-64)` fixture has
the `exact` present **twice in `oldBody`** and relocates the anchor's own occurrence
(→ `"deleted"` → `verifiedSurvivor` → orphan). The new fixture has `B` present **once in `oldBody`**
(I measured: `B occurrences in oldBody: [75]`), duplicated only by the edit, classifying `equal`
with a mapped slice byte-identical to the `exact`. My own library run confirms the escalated
scenario ends in a remap while `resolveAnchorExact` returns `null` — i.e. the uniqueness chain, had
it run, would have orphaned. The remap therefore cannot have come from the verification path; the
fast path is the only remaining producer. That is an independent corroboration of the log's
coverage-probe claim (`verifiedSurvivor` 0 hits, fast-path return 1 hit), which I did not re-run
(coverage runs were out of bounds for this evaluation).

### TEST-84 evidence (independent real-server reproduction)

Workspace `corpus init /tmp/corpus-e008-s014-eKCc4Q/ws --port 8973`; daemon pid 6886.

Anchor written by `POST /api/threads` (thread `th_5c64zpq3`, anchor `anc_e0d88019`), on disk before
the edit:

```yaml
anchors:
  anc_e0d88019:
    exact: Bravo section explains the quarterly budget review and its sign-off flow.
    prefix: |+
      als and the welcome checklist.

    suffix: |-


      Charlie section documents inci
```

`PUT /api/docs/doc_6pxrc7bp` with the `[C,B,A,B,D]` body:

```
response.anchors        = {"remapped":["anc_e0d88019"],"orphaned":[]}
response frontmatter    = {"anc_e0d88019":{"exact":"Bravo section explains the quarterly budget review and its sign-off flow.",
                            "prefix":"on paths for the on-call rota.\n\n","suffix":"\n\nAlpha section covers onboardin"}}
```

On disk (`data/docs/inbox/s014-reorder-probe-2.md`) and in `git diff HEAD~1 HEAD`, in the save's own
auto-commit `e608f8d doc edit: S014 reorder probe (doc_6pxrc7bp) by user`:

```diff
 anchors:
   anc_e0d88019:
     exact: Bravo section explains the quarterly budget review and its sign-off flow.
     prefix: |+
-      als and the welcome checklist.
+      on paths for the on-call rota.

     suffix: |-


-      Charlie section documents inci
+      Alpha section covers onboardin
```

`GET /api/docs/doc_6pxrc7bp` afterwards:

```json
[{"anchorId":"anc_e0d88019","selector":{"exact":"Bravo section explains the quarterly budget review and its sign-off flow.","prefix":"on paths for the on-call rota.\n\n","suffix":"\n\nAlpha section covers onboardin"},"threadId":"th_5c64zpq3","threadStatus":"open","range":{"start":82,"end":155},"orphaned":false}]
```

`range {"start":82,"end":155}` is byte-for-byte the library's mapped range, and `orphaned:false`
means the thread renders inline rather than under detached threads — the disk result and the
library result agree, and both agree with the blessed policy. My run also picked the **first**
occurrence, matching the issue's log rather than the SERVER-013 eval's second-occurrence pick,
because the fixture bytes are the issue's.

### TEST-110 / TEST-111 evidence, and where they landed

**Where they landed:** in **SERVER-014**'s issue file, not SERVER-022's — under the heading
"Rider — SERVER-022 finding 4 (reassigned): whitespace-only `exact` — **FIXED**" (issue lines
93–111), with the disk pass folded into the same E2E log (item 4 of the real-server section) and a
sentence in the Domain Knowledge entry. That satisfies the sprint's requirement that the E2E log
record where each reassigned finding landed. SERVER-022's own file was not consulted for this
verdict.

Mint path (correctly still refuses to create such an anchor):

```
POST /api/threads {"selector":{"exact":"   ",…}}
→ HTTP 400 {"code":"bad_request","message":"an anchor needs the text it quotes",
   "issues":[{"path":"selector.exact","message":"must contain at least one non-whitespace character"}]}
```

Anchor seeded through the legitimate out-of-band path (direct frontmatter edit; the watcher
reconciled and re-projected, `orphaned:false`, `range {"start":18,"end":21}`). Then:

| Save                                                                 | Response `anchors`                             | Selector on disk                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Tail paragraph rewritten (change **elsewhere**) — TEST-110            | `{"remapped":[],"orphaned":[]}`                | byte-unchanged: `exact: "   "`, prefix/suffix intact               |
| `alpha   beta` → `alphabeta` (own text **deleted**) — TEST-111        | `{"remapped":[],"orphaned":["anc_9523f6e1"]}`  | preserved byte-for-byte; `range:null, orphaned:true`               |
| `alpha   beta` → `alpha beta` (own text **shrunk**, partial) — TEST-111 | `{"remapped":[],"orphaned":["anc_86ee2b29"]}`  | preserved byte-for-byte                                            |

`git show --stat 389208e -- packages/contract` → empty. (`git diff abb6b48..4ea3e4b -- packages/contract`
is **not** empty, but every hunk in it belongs to CONTRACT-007, CONTRACT-009 and SERVER-023, which
are separate commits in the range; SERVER-014's own commit touches only `.claude/agents/server-dev.md`,
`apps/server/src/anchors/reconcile.{ts,test.ts}` and its issue file.)

## Failures

None. No criterion failed. Two observations are recorded below; neither is a criterion-level
failure, and neither warrants a fix under the sprint's own framing.

### OBS-1 (TEST-80, evidence form): the opposite-policy demonstration is recorded as a result, not as a re-runnable artifact

**Criterion**: TEST-80 — "demonstrated by the fact that it FAILS if the opposite policy is
implemented."
**Expected**: the log shows the named test failing under an orphan-on-duplicate engine.
**Observed**: the log reports the *outcome* of exactly that experiment with concrete values —
"with a temporary orphan-on-duplicate patch in the drafts pass, the named test **fails**
(`remapped: []`/`orphaned: ["anc_b"]`) — and so does the shipped `it(…TEST-65)`" — but the patch
itself is not recorded, so the demonstration cannot be re-run from the record. This is stronger
than a bare assertion (it quotes the failing values and names a second test that fell with it), but
weaker than a reproducible artifact.
**Why it is not a failure**: the substantive claim is independently established without the patch.
My re-derivation shows the fixture reaches the engine with `classification = equal`, a mapped slice
byte-identical to the `exact`, and `resolveAnchorExact = null`; the engine nevertheless remaps. Any
orphan-on-duplicate policy would, by construction, turn that into `orphaned: ["anc_b"]` and fail the
test's `expect(report).toEqual({unchanged: [], remapped: ["anc_b"], orphaned: []})`. The test is
therefore genuinely policy-discriminating, which is what the criterion is protecting.

### OBS-2 (TEST-82, evidence form): production code changed, but the accompanying A/B is two fixtures, not a seeded sweep

**Criterion**: TEST-82 — "If code changed at all, an A/B sweep in the style of SERVER-012/013
accompanies it with **seeds stated**."
**Expected**: a seeded sweep A/B, as SERVER-012 and SERVER-013 supplied.
**Observed**: the log supplies a targeted two-fixture A/B (policy fixture: baseline ≡ current;
whitespace fixture: the sanctioned flip) and states no seeds. Production code did change — the
one-line `classification === "partial" &&` gate.
**Why it is not a failure**: the criterion's substantive requirement — every must-hold assertion
producing identical results — is independently verified (70/70 in `reconcile.test.ts` with all 64
pre-existing tests unmodified; 2046/2046 across `apps/server`; the seeded property-sweep suite
passes unmodified). And the sweep's purpose, catching out-of-class flips, is discharged
structurally by the diff I was required to read: the gate can only change behavior when the mapped
slice is blank *and* the classification is not `partial`, and on an `equal` classification the
mapped slice is the anchor's own text — so a blank slice on `equal` is reachable only for a
whitespace-only `exact`, which is exactly the sanctioned class. A sweep over ordinary prose fixtures
could not have flipped anything.

### Out-of-scope observation (not SERVER-014's, filed here only so it is not lost)

A malformed JSON body on `POST /api/threads` returns **HTTP 500** `{"code":"internal_error"}` with
`Error: Malformed JSON in request body` logged as an *unhandled* error, where a 400 is the correct
answer. Reproduced incidentally while setting up the whitespace fixture; unrelated to this issue's
diff, and it belongs to whoever owns the request-validation error mapping.

## Summary

SERVER-014 **PASSES** all eleven criteria (TEST-77…85, TEST-110, TEST-111).

The issue closes the way the sprint said it legitimately could: **current behavior blessed, one line
of production code** — and that line is the reassigned finding-4 gate, not the policy. The deliverables
that actually mattered are all present and all hold up under independent re-derivation. The
reproduction was run at HEAD before any change and every quoted value reproduces byte-for-byte on my
own harness; the apparent divergence from `SERVER-013-eval.md`'s offsets is a fixture-bytes
difference, and I reproduced the eval's exact `[263,348]`-shaped outcome (second occurrence chosen,
`prefix` preserved, `suffix` rewritten) by matching the paragraph geometry — the finding has not
moved. The rationale names option (a), quotes §6 sentences I verified verbatim at `SPEC.md:208–210`,
and states the causal rule in one sentence that correctly reconciles the two shipped tests.

The sharpest criterion, TEST-80, is genuinely discharged: the new named test uses the escalation's
fixture, `B` occurs **once** in `oldBody` (measured), the range classifies `equal`, and the engine
remaps even though `resolveAnchorExact` returns `null` — so the remap can only have come from the
trusted-slice fast path, which the pre-existing `"deleted"`-path test never touches. Both tests run
and pass independently.

The real-application half is reproducible: I re-ran the disk pass from scratch on 8973 and got the
same response (`remapped:["anc_e0d88019"]`), the same on-disk selector (`exact` byte-identical,
context refreshed), the same single auto-commit, and `range {"start":82,"end":155}, orphaned:false`
from the API — the library outcome and the disk outcome agree exactly. The whitespace rider holds in
all three directions on the same real server.

Two evidence-form observations (OBS-1, OBS-2) are recorded; neither changes the verdict, and the
sprint's own adjudication ("current behavior blessed is a first-class PASS") plus independent
verification cover the gaps they name.

**Hygiene**: scratch confined to `/tmp/corpus-e008-s014-eKCc4Q`; daemon stopped by recorded pid 6886;
port **8973 free**, port **8765 unbound**; no state-changing git command run in the corpus repo.
