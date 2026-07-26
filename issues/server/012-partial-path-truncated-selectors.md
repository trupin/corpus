# [SERVER-012] Anchor engine: partial-path can emit truncated selectors beside near-identical edited siblings

## Domain

server

## Status

todo

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

- [ ] Reproduce the evaluator's scenario as a regression test: two near-identical paragraphs, one deleted and one edited in the same write, each carrying an anchor — no anchor ends up with a truncated `exact` or with text that belonged to the other anchor.
- [ ] A remapped selector's `exact` always equals the full text of the range it claims (`newBody.slice(start, end)`), never a truncation — enforced as a general invariant test over the reconcile property sweep, not just the one fixture.
- [ ] When the mapped slice for a `partial` range fails that invariant (degenerate/truncated), the anchor takes the deleted-claim verification path (exact-only + insertion-overlap) instead of trusting the slice; if that also fails, it orphans with the selector preserved byte-for-byte.
- [ ] The SERVER-002 round-2/round-3 must-holds all still pass: TEST-26 remapped, the four deletion scenarios orphaned, cut-and-paste re-attaches, doppelgänger orphans, escalating-context sequence all-remapped, M1 disk matrix green.
- [ ] Determinism, purity, immutability, and perf order of magnitude unchanged.

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

_[Agent fills — required: this is a bug issue.]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-012]` prefix
