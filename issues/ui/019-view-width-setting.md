# [UI-019] Wider views: user-adjustable view/column width

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-003 (board columns)
- Blocks: —

## Spec References
- SPEC.md §10 — board (needs a spec-writer pass: no width/layout preference is currently specified, and no settings panel exists)

## Summary
User request (2026-07-29, follow-up phase after PR #11): views are too narrow, and the
user looked for "a settings panel somewhere" to widen them — there isn't one. Make view
width user-adjustable. Design questions for the spec pass: per-view drag-to-resize vs.
a global width setting (or both); where the preference lives (no settings surface
exists today — localStorage vs. a workspace config the server owns; note the
server-sole-writer rule if it's file-backed); and whether this seeds a general settings
panel or stays a minimal affordance.

## Acceptance Criteria
- [ ] spec-writer amends SPEC.md with the chosen mechanism (user-signed-off)
- [ ] User can make views wider through a discoverable UI affordance
- [ ] The width choice persists across reloads
- [ ] Layout degrades sanely on narrow windows (existing responsive behavior preserved)

## Technical Design

### Files to Create/Modify
- apps/ui board/column layout components; persistence per spec decision

### Key Implementation Details
To be refined after the spec amendment.

### Edge Cases
- Many columns × wide setting → horizontal scroll behavior.
- Plugin-provided views (todos column) should honor the same width mechanism.

## Testing Strategy
Vitest for persistence logic; Playwright for resize + reload persistence.

## E2E Verification Plan

### Verification Steps
1. Real app: widen a view, reload, width persists; narrow window still usable

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
