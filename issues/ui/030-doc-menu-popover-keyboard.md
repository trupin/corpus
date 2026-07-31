# [UI-030] Reader ⋯ popover: no keyboard navigation (roving focus never enters)

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-005
- Blocks: —

## Spec References
- SPEC.md §11 — context-menu conventions ("adds no exclusive capability"; arrows/↵); reader ⋯ menu

## Summary
Evaluator finding (2026-07-31, Phase 6 LEDGER-P6-1): the reader's ⋯ *button* popover
(`DocMenu`, a different frame from the right-click context menu) has proper
`role=menuitem` buttons but focus never enters — ArrowDown and Tab leave
`activeElement` on the trigger, so Enter re-toggles the trigger and no action ever
runs from the keyboard. This is absent roving focus, NOT UI-028's interception (that
fix is verified working on the right-click frame). Give the popover the same roving
focus/activation model as `ContextMenu` (share the mechanism, don't fork it); check
the 💬 comments popover for the same gap while there.

## Acceptance Criteria
- [ ] ⋯ popover: ArrowDown/ArrowUp move focus, Enter/NumpadEnter/Space activate (asserted by effect), esc closes without running
- [ ] Shared mechanism with ContextMenu, not a copy; 💬 popover audited and fixed if identical
- [ ] e2e keyboard case on the ⋯ popover

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/DocMenu.tsx` (+ CommentsPopover if affected), shared roving-focus hook with `menu/ContextMenu.tsx` (+ tests)

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app: open ⋯ with the keyboard, arrow to Archive, Enter — the action runs.

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
