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

_[Agent fills — required.]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-013]` prefix
