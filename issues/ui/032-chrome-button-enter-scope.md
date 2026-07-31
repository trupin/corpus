# [UI-032] Board's ↵ shortcut preempts focused chrome buttons (⋯ trigger can't open by keyboard)

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-028, UI-030
- Blocks: —

## Spec References
- SPEC.md §11 — keyboard scheme (`↵` open the highlighted document); menu conventions ("adds no exclusive capability")

## Summary
UI-030 escalation (2026-07-31, reproduced in a real browser): with focus on the
reader's ⋯ trigger (or any focused chrome `<button>` outside an open menu), `↵` never
activates it — the board scope's `rows.open` binding matches on the document listener
and `preventDefault()` cancels native activation. UI-028 fixed this for OPEN menus
(`role="menu"` scope-out); this is the closed-menu case: focused chrome controls.
The naive fix (skip when a button has focus) is unsafe — `.row` is itself a `<button>`
deliberately bound to `↵`. Design the scoping rule: e.g. `rows.open` matches only
when the focused element is a row or nothing focusable holds focus; a
`data-board-shortcut-exempt` marker on chrome controls; or scope shortcut matching by
focus target generally. Prove the rule against BOTH cases: row-↵ still opens the
highlighted document; trigger-↵ opens the popover (then UI-030's roving focus takes
over). Space currently works on triggers (unbound) — must keep working.

## Acceptance Criteria
- [ ] Focused ⋯ / 💬 / any chrome button: `↵` activates it natively; board shortcut does not fire
- [ ] Highlighted row: `↵` still opens the document (regression pinned)
- [ ] The rule is one mechanism, not per-button patches; documented in shortcuts.ts
- [ ] e2e keyboard case: focus ⋯ via keyboard → ↵ → popover opens → arrows/↵ run an action (completing the §11 no-pointer path end-to-end)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/keyboard/useShortcuts.ts` / `shortcuts.ts` (+ tests); e2e context-menu spec

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app, keyboard only: tab/focus the ⋯ trigger, ↵, arrow, ↵ — action runs; row ↵ unchanged.

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
