# [UI-018] Right-click context menu for actions on the selected item

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-004 (type-aware rows), UI-012 (DocMenu)
- Blocks: —

## Spec References
- SPEC.md §10/§11 — board and document interactions (needs a spec-writer pass: context-menu behavior is currently unspecified)

## Summary
User request (2026-07-29, follow-up phase after PR #11): override the browser's
right-click so a context menu surfaces the actions available on whatever item is under
the cursor / selected — document row, view/column, thread, etc. The actions themselves
already exist (DocMenu, view menus); this is a second, pointer-native way to reach
them. Design questions for the spec pass: which surfaces get a menu, whether native
browser context menu remains reachable (e.g. on text selection for copy), and keyboard
accessibility parity.

## Acceptance Criteria
- [ ] spec-writer amends SPEC.md with the surface-by-surface behavior (user-signed-off)
- [ ] Right-click on a document row / view header / other specified surfaces opens a menu with that item's existing actions (no new actions invented)
- [ ] Native context menu preserved where spec'd (at minimum: inside text selections and editable fields)
- [ ] Menu is dismissible and keyboard-accessible per the app's existing menu conventions

## Technical Design

### Files to Create/Modify
- apps/ui — a shared context-menu component (or @corpus/kit if plugins should reuse it); wire into row/view components

### Key Implementation Details
Reuse the action lists that power DocMenu/view menus — one source of actions, two presentations. To be refined after the spec amendment.

### Edge Cases
- Right-click on an item that isn't the current selection (menu targets the clicked item).
- Plugin-rendered surfaces (todos view) — in or out of scope, decide at spec time.

## Testing Strategy
Vitest for menu wiring; Playwright for right-click flows.

## E2E Verification Plan

### Verification Steps
1. Real app: right-click a doc row → its actions appear and work; right-click selected text → native menu still available (per spec decision)

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
