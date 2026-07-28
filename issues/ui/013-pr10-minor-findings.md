# [UI-013] UI hardening batch: PR #10 MINOR findings

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus — five scoped fixes with the reviewer's diagnosis already written.

## Dependencies

- Depends on: UI-006, UI-007, UI-008
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), findings 11/12/14/18/19

## Summary

The pr-reviewer's MINOR findings in the UI slice, batched (the PR #9 → SERVER-022/CLI-008
precedent). Finding 13 is already filed as UI-012.

## Acceptance Criteria

- [ ] (11) `thread/Turn.tsx:39-48` — trace parsing matches §6 exactly: `↳ ` requires the trailing
      space, no indented lines, and the check runs on the true final line (before
      attachment-ref splitting can promote an earlier line).
- [ ] (12) `thread/parseFormBlock.ts:112-129` — with two unanswered forms sharing an option
      string, the answer attaches to the right form (use the known `formTs` instead of
      re-deriving from prose).
- [ ] (14) `reader/LockBanner.tsx:40-49` — the held-duration line ticks (a minute-interval
      re-render) instead of freezing at mount.
- [ ] (18) editor/anchor edge batch: run-location vs adjacent URL syntax; the length-equality
      licence for server offsets vs length-compensating constructs; the no-entities test pins
      decimal + named forms too; trace cache holds ≥2 entries; post-save self-echo adoption
      skipped at source rather than repaired downstream.
- [ ] (19) board polish: no-change Edit-query blur sends no PUT; a plugin column without `query`
      does not fetch the unfiltered doc list; pending-turn drop predicate can't transiently hide
      a second in-flight turn.

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
