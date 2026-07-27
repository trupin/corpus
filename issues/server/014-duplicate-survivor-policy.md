# [SERVER-014] Anchor engine: duplicate-survivor policy — remap-one vs orphan (TEST-64/66 tension)

## Domain

server

## Status

todo

## Priority

P2

## Model

fable — a policy question inside the adjudicated anchor-engine design; whichever way it resolves must not disturb the five closed adjudications.

## Dependencies

- Depends on: SERVER-013
- Blocks: —

## Spec References

- SPEC.md §6 — resolution ladder, orphan semantics
- `issues/evals/SERVER-013-eval.md` — TEST-64 escalation (discovery record, 4-step reproduction)
- `.claude/agents/server-dev.md` → Domain Knowledge — the five anchor adjudications

## Summary

> **Sprint-008 adjudications (orchestrator, 2026-07-27):** (a) SPEC.md §6 as amended by SHARED-002 resolves the policy question in favor of **blessing current behavior** — "threads orphan when their text is genuinely gone" with byte-preservation promised for *orphans only*, and remapped anchors refresh context; acceptance path (a) below is the expected outcome, with the written rationale still required. (b) The planner found the passing test named for TEST-64 uses a `"deleted"`-classification fixture and does **not** exercise the evaluator's fast-path scenario (`reconcile.ts:145`) — the new named reproduction test must cover the fast path, not re-cover the deleted path. (c) **Reassigned in**: SERVER-022 finding 4 — a whitespace-only `exact` (contract allows `.min(1)` whitespace) is orphaned by any save that never touched it because the blank-slice guard fires on `equal` classifications; gate the guard on `partial`/`deleted` (no contract change). This lands here because it is a reconcile-classification judgment, same file, same reasoning.

Escalated by the sprint-004 evaluator, explicitly **not a blocker**: when an anchor's text survives verbatim at **two** locations after an edit, the engine remaps to one of them (and rewrites the selector's context) rather than orphaning on ambiguity — byte-identical to the round-2 engine, i.e. long-standing policy, and sprint-004's TEST-64 (orphan-on-ambiguity, byte-preserved selector) and TEST-66 (mapper's choice stands when both candidates are verbatim) are in direct tension about it. Changing either direction violates the other test as written. This issue exists to make the policy question explicit rather than lose it; it may well close as "current behavior is correct — fix TEST-64's expectation."

## Acceptance Criteria

- [x] The tension is resolved with a written rationale: either (a) current behavior blessed (mapper's causal choice outranks duplicate ambiguity; update the test expectation and Domain Knowledge), or (b) true-ambiguity orphaning specified causally (no similarity thresholds) with proof it doesn't disturb TEST-63/66 or any closed adjudication. **→ Option (a): current behavior blessed. Rationale below.**
- [x] The evaluator's 4-step reproduction becomes a named test asserting whichever policy is chosen. **→ `reconcile.test.ts`, describe "duplicate-survivor fast path: the mapper's causal choice is blessed (SERVER-014)" — covers the line-`newRange: mapped` fast path, not the already-covered `"deleted"` path (sprint TEST-80).**
- [x] All five closed adjudications' must-hold suites stay byte-identical. **→ Zero policy-relevant engine change (the only production hunk is the reassigned finding-4 gate, which no existing fixture reaches); all 64 pre-existing `reconcile.test.ts` tests pass unmodified, 1968/1968 in `apps/server`.**

## Resolution — option (a): the mapper's causal choice is blessed (rationale, per §6 as amended)

**The governing sentences.** SPEC.md §6 (as amended by SHARED-002, commit `a2bec87`) gives four
behavioral guarantees, and three of them decide this shape directly:

1. *"Threads orphan when their text is genuinely gone."* In the reproduction, `B` survives at two
   locations in `newBody`. Its text is not gone — it is doubly present. Orphaning the thread would
   contradict the spec's only stated cause for orphaning.
2. *"An anchor whose text the edit left alone keeps its `exact`, with `prefix`/`suffix` refreshed
   from the new surroundings."* The evaluator's step-4 observation — `exact` byte-preserved,
   `suffix` rewritten — is this sentence executing. A rewritten suffix on a **remapped** anchor is
   required behavior, not a violated promise: byte-for-byte selector preservation is promised in §6
   for **orphans** specifically (*"An orphaned anchor always preserves its last selector
   byte-for-byte"*). TEST-64's sprint-004 criterion text demanded orphan semantics *and*
   byte-preservation on an outcome that is observably a remap — it conflated the two branches.
3. *"A thread is re-attached only to text the edit demonstrably carried forward, never to a
   lookalike."* Neither candidate occurrence is a lookalike; both **are** the text, and the diff's
   positional alignment is the demonstration. The choice is causal (which occurrence the edit
   mapped the anchor's own bytes onto), not arbitrary — the evaluator's own escalation says as
   much: *"the choice is positional (diff-derived), not arbitrary."*

**Why the mapper's causal choice outranks duplicate ambiguity.** Ambiguity is a property of
*resolution from scratch* — a selector, a body, and no history. Reconciliation has history: the
diff aligns the anchor's own old bytes to a specific location in `newBody`, and when the slice at
that location is byte-identical to the anchor's `exact`, the edit demonstrably carried the text
there. A second verbatim occurrence elsewhere is evidence about the *document* (it now quotes the
same words twice), not about *this anchor* — exactly as the SERVER-002 adjudication held for
pre-existing doppelgängers (in-place-edit evidence outranks a verbatim duplicate elsewhere) and as
the SERVER-013 relocation rule held in reverse (only a survivor the mapper did *not* choose, sitting
in INSERT text while the mapped slice was *rewritten*, impeaches the slice). When the mapped slice
is verbatim there is no claim to impeach — uniqueness rules exist to keep re-placement from
guessing, and nothing here is being re-placed.

**The one-sentence causal rule that separates the two shipped tests (sprint TEST-79):** the
uniqueness rules run only when the engine has lost the anchor's own bytes and must *prove* survival
— a `"deleted"` classification or an impeached slice — whereas a mapped slice byte-identical to the
`exact` is the edit itself demonstrating where the text went, so there is nothing to prove and no
ambiguity to adjudicate. The shipped `it(…TEST-64)` fixture (exact present twice in `oldBody`, the
anchor's own occurrence relocated → classification `"deleted"` → re-placement must prove survival →
two candidates, no surviving context → orphan) and the shipped `it(…TEST-65)` fixture (mapped slice
verbatim → nothing to prove → remap stands) are therefore both correct simultaneously, and the
evaluator's fixture is simply TEST-65's causal situation wearing TEST-64's occurrence count.

**What was corrected in the record (sprint TEST-85).** No shipped test expectation contradicts the
blessed policy — the `it(…TEST-64)` fixture genuinely exercises the `"deleted"` path, where orphan
+ byte-preservation *is* the right expectation, so it stands unmodified. The stale expectation
lived in sprint-004's TEST-64 *criterion text* (orphan-on-ambiguity applied to a remap outcome);
this issue file and a dated Domain Knowledge entry in `.claude/agents/server-dev.md` are the
correction. The gap the escalation actually exposed — the fast path had no named coverage — is
closed by the new named test.

## Rider — SERVER-022 finding 4 (reassigned): whitespace-only `exact` — **FIXED**

`TextQuoteSelectorSchema.exact` requires only `.min(1)`, so a whitespace-only `exact` is
schema-valid (the thread-create route refuses to *mint* one — `threads/create.ts:85` — but
frontmatter is source of truth and out-of-band edits legitimately produce them). The blank-slice
guard (`isBlank(mapped)`) fired on **every** classification, and for such an anchor a correctly
resolved match necessarily trims to nothing — so any save anywhere in the document orphaned it.
The guard conflated "the new slice degenerated under an edit" (correct suspicion) with "the
anchor was always whitespace" (not this edit's business).

**Fix**: `reconcile.ts` gates the guard on the `partial` classification —
`const blank = classification === "partial" && isBlank(mapped);` (one line; the `"deleted"` branch
never consulted `blank` and is unchanged). No contract change (`git diff` over `packages/contract`
is empty). Regression tests both directions in `reconcile.test.ts`
("whitespace-only exact: the blank-slice guard is classification-gated"): untouched-save stays
attached byte-identical; context-window edit stays attached with `exact` preserved; own-text
deletion still orphans; partial shrink still routes through verification and orphans. The two
pre-existing degenerate-whitespace-slice tests (partial-classification blank slices on normal
anchors) pass unmodified — the guard still fires where it must.

## Technical Design

As shipped: `apps/server/src/anchors/reconcile.ts` — one-line classification gate on the
blank-slice guard (the finding-4 rider; the duplicate-survivor policy itself is a zero-code
blessing). `apps/server/src/anchors/reconcile.test.ts` — two new describe blocks (6 tests): the
evaluator's 4-step reproduction pinned to the trusted-slice fast path with an in-test structural
probe, plus the whitespace-gate regressions.

## Testing Strategy

The named reproduction test plus the standing A/B must-hold suites.

## E2E Verification Plan

### Verification Steps

1. Reproduce the evaluator's 4-step scenario pre-change; log it.
2. Post-change: the chosen policy holds on disk; must-hold suites unchanged.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

**Implemented on: fable** (matches the issue's Model recommendation).

### Reproduction (bugs only)

Method: the pre-change engine restored **byte-for-byte** from
`git show HEAD:apps/server/src/anchors/reconcile.ts` (HEAD = `de47882`) into a scratch module
alongside verbatim copies of its siblings, run A/B against the worktree engine with
`node --import tsx` (harness at `node_modules/.s014-baseline/repro.ts`, removed after use).

**Fixture 1 — the SERVER-013-eval TEST-64 escalation, 4 steps** (`oldBody` = four wholly-distinct
paragraphs `[A,B,C,D]`, whole-paragraph anchor on B; `newBody` = `[C,B,A,B,D]`). Verbatim output
at HEAD, before any change (sprint TEST-77):

```
B occurrences in newBody: [82,225]                          (occurrence count 2; once in oldBody)
classification of B's old range: equal
mapped slice === B: true {"start":82,"end":155}
resolveAnchorExact(newBody, old selector): null             (the verification chain would ORPHAN)
baseline(HEAD): report={"unchanged":[],"remapped":["anc_b"],"orphaned":[]}
                resolved={"start":82,"end":155} exactPreserved=true prefixPreserved=false suffixPreserved=false
current       : identical to baseline
```

Same report shape as the evaluator's record (`{"unchanged":[],"remapped":["anc_b"],"orphaned":[]}`,
`exact` byte-preserved, context rewritten, one occurrence chosen) — the finding has not moved since
SERVER-013. My diff alignment picks the first occurrence (after C) where the evaluator's strings
aligned after A; both are the mapper's positional choice, which is the point. Note `classification
= equal` and `mapped slice === exact`: the fixture takes the trusted-slice fast path
(`newRange: mapped`), and `resolveAnchorExact = null` proves the uniqueness rules, had they run,
would have orphaned — this is the uncovered path sprint TEST-80 names, distinct from the shipped
`it(…TEST-64)` fixture's `"deleted"` path.

**Fixture 2 — whitespace-only `exact` (finding 4), pre-fix at HEAD**: anchor
`{"exact":"   ","prefix":"# Alignment\n\nalpha","suffix":"beta sits in the first paragraph"}`,
edit in a distant paragraph; classification of the untouched range: `equal`.

```
baseline(HEAD): report={"unchanged":[],"remapped":[],"orphaned":["anc_ws"]}   ← the bug: orphaned by a save that never touched it
current       : report={"unchanged":["anc_ws"],"remapped":[],"orphaned":[]}   ← post-fix
```

### Post-Implementation Verification

**Unit/integration** (`./node_modules/.bin/vitest run apps/server/src/anchors`): 8 files,
**186 tests, all pass** — 64 pre-existing `reconcile.test.ts` tests **unmodified** plus 6 new
(2 duplicate-survivor, 4 whitespace-gate). Full `apps/server` suite: **103 files, 1968 tests, all
pass**. Build, `npm run lint`, `npm run format:check`, `npm run typecheck` all green.

**Fast-path proof for the named test** (sprint TEST-80, two independent probes):

- In-test structural probe: classification asserted `"equal"`, mapped slice asserted byte-equal to
  `exact` (so `rewritten`/`blank`/`suspect` are structurally off), and
  `resolveAnchorExact(newBody, selector)` asserted `null` — a remap can only have come from the
  fast path.
- Coverage probe: `vitest run -t "evaluator's 4-step reproduction" --coverage` over `reconcile.ts`
  → `verifiedSurvivor` body line **0 hits**, the `newRange: suspect ? … : mapped` return **1 hit**.
- Opposite-policy demonstration: with a temporary orphan-on-duplicate patch in the drafts pass, the
  named test **fails** (`remapped: []`/`orphaned: ["anc_b"]`) — and so does the shipped
  `it(…TEST-65)`, confirming the recorded tension. Patch reverted; suite re-run green.

**No similarity constant entered the engine** (sprint TEST-81): `git diff -- apps/server/src/anchors/`
production hunk is 9 lines (8 comment + the one-line gate); grep of added lines for
`similarity|fuzzy|score|ratio|threshold|leven|float literals`: **0 matches**.

**Adjudication suites** (sprint TEST-82/83): no engine behavior change on any adjudicated path
(the gate only affects `equal`-classified blank slices, reachable solely by whitespace-only
`exact`s, which no prior fixture contains). `it(…TEST-65)`, `it(…TEST-64)`, the 68c must-not-fix
corner, TEST-61/63 duplicate suite, musical-chairs, nested-exemption, TEST-67c, determinism and
order-independence: all pass unmodified. Code changed ⇒ per sprint TEST-82 an A/B accompanies it:
the two-fixture A/B above shows baseline ≡ current on the policy fixture, and the whitespace flip
is the sanctioned finding-4 fix.

**Real-server disk pass** (sprint TEST-84 + TEST-110; port **8925**, scratch
`/tmp/corpus-s014-sFZO4S/ws`, entry `node --import tsx apps/cli/src/bin/corpus.ts`, server stopped
by pid via `corpus server stop`, 8925 and 8765 verified free after):

1. `corpus init --port 8925` → real workspace, git repo, seeded corpus. `corpus server start`
   (pid 7851).
2. `POST /api/docs` with the `[A,B,C,D]` body → `doc_td2xnp7o`; `POST /api/threads` with the B
   selector → `th_avfzrduw`, `anchorId anc_e3d807bb`; selector on disk verbatim.
3. `PUT /api/docs/doc_td2xnp7o` with `[C,B,A,B,D]` → response
   `anchors: {"remapped":["anc_e3d807bb"],"orphaned":[]}`. On disk and in
   `git diff HEAD~1 HEAD`: `exact` byte-identical
   (`Bravo section explains the quarterly budget review and its sign-off flow.`), `prefix` flipped
   `als and the welcome checklist.` → `on paths for the on-call rota.`, `suffix` flipped
   `Charlie section documents inci` → `Alpha section covers onboardin` — the anchor followed the
   mapper's choice (first occurrence, after C, matching the library run's offset 82), context
   refreshed in the same auto-commit (`doc edit: S014 reorder probe … by user`). Thread stays
   attached: **the blessed policy holds on disk**.
4. Whitespace rider: `POST /api/threads` with `exact: "   "` is **refused** by the server's own
   guard (`400`, "an anchor needs the text it quotes", `threads/create.ts:85`) — so the anchor was
   seeded via the legitimate out-of-band path (direct frontmatter edit; watcher reconciled and
   re-projected, selector intact). Then `PUT /api/docs/doc_pd7og76z` editing only the tail
   paragraph → response `anchors: {"remapped":[],"orphaned":[]}` and the selector on disk
   **byte-unchanged** (`exact: "   "`, prefix/suffix intact) across the save's auto-commit. Pre-fix
   this exact shape orphaned at library level (Fixture 2 above).

Deferred/none: no criterion deferred. Scratch retained at `/tmp/corpus-s014-sFZO4S` for the
evaluator; baseline harness under `node_modules/` removed.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-014]` prefix
