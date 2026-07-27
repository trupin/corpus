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

Escalated by the sprint-004 evaluator, explicitly **not a blocker**: when an anchor's text survives verbatim at **two** locations after an edit, the engine remaps to one of them (and rewrites the selector's context) rather than orphaning on ambiguity — byte-identical to the round-2 engine, i.e. long-standing policy, and sprint-004's TEST-64 (orphan-on-ambiguity, byte-preserved selector) and TEST-66 (mapper's choice stands when both candidates are verbatim) are in direct tension about it. Changing either direction violates the other test as written. This issue exists to make the policy question explicit rather than lose it; it may well close as "current behavior is correct — fix TEST-64's expectation."

## Acceptance Criteria

- [ ] The tension is resolved with a written rationale: either (a) current behavior blessed (mapper's causal choice outranks duplicate ambiguity; update the test expectation and Domain Knowledge), or (b) true-ambiguity orphaning specified causally (no similarity thresholds) with proof it doesn't disturb TEST-63/66 or any closed adjudication.
- [ ] The evaluator's 4-step reproduction becomes a named test asserting whichever policy is chosen.
- [ ] All five closed adjudications' must-hold suites stay byte-identical.

## Technical Design

To be decided by the resolution; expected footprint is `reconcile.ts` + tests only, possibly zero code (test-expectation fix).

## Testing Strategy

The named reproduction test plus the standing A/B must-hold suites.

## E2E Verification Plan

### Verification Steps

1. Reproduce the evaluator's 4-step scenario pre-change; log it.
2. Post-change: the chosen policy holds on disk; must-hold suites unchanged.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills]_

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
- [ ] Committed with `[SERVER-014]` prefix
