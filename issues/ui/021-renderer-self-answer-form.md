# [UI-021] Renderer: a form-carrying answer turn leaves its own form unanswerable-forever

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-008
- Blocks: —

## Spec References
- SPEC.md §6 — forms; §14 — needs=form

## Summary
SERVER-032's audit fix round (FIX 10, 2026-07-30): the server now counts a turn that
both answers a form and carries one as BOTH — it closes the earliest open form offering
its option, then opens its own. The UI's `mapFormAnswers`
(`apps/ui/src/thread/parseFormBlock.ts`) still `continue`s past its own registration,
leaving such a form rendered live forever and now disagreeing with the detector the
server pinned. One-line change per the server's docblock; add the paired test mirroring
the server's named case. Only hand-edited files produce the turn — low urgency, but the
divergence is documented server-side and should not outlive the phase after this one.

## Acceptance Criteria
- [ ] Renderer and server detector agree on the both-answer-and-form turn (paired test)
- [ ] Answering the newly-opened form clears it in the UI

## Technical Design
### Files to Create/Modify
- apps/ui/src/thread/parseFormBlock.ts (+ test)

## Testing Strategy
apps/ui scoped.

## E2E Verification Plan
Hand-edited fixture thread; renderer count matches `needs=form`.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
