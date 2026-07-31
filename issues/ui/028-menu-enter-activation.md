# [UI-028] `↵` does not activate context-menu items (Space does)

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-018
- Blocks: —

## Spec References
- SPEC.md §11 context menu: "`esc` dismisses, arrows navigate, `↵` activates"

## Summary
Evaluator finding (2026-07-30, LEDGER-2 — pre-existing since UI-018; TEST-439 only
ever exercised ArrowDown): with roving focus correctly on a menu item, `Enter` and
`NumpadEnter` do nothing — the menu stays open, the action never runs; only `Space`
activates. True of every Corpus menu (row, header, reader, job, selection). Direct
§11 violation. Likely a keydown handler consuming/ignoring Enter on the focused
button (buttons natively activate on Enter — something intercepts). Fix in the shared
menu component, add both Enter variants to its tests, and extend the e2e keyboard
case to actually press `↵`.

## Acceptance Criteria
- [ ] `Enter` and `NumpadEnter` activate the focused item in every menu surface; `Space` still works; `esc` still dismisses
- [ ] Unit tests cover both variants; the e2e keyboard path asserts an action actually ran via `↵`

## Technical Design
### Files to Create/Modify
- `apps/ui/src/menu/ContextMenu.tsx` / `MenuItems.tsx` (find the interceptor) + tests; e2e context-menu spec keyboard case

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app: open a row menu via ⇧F10, ArrowDown, `↵` — the action runs.

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
