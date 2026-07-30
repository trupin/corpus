# [UI-020] Unarchive affordance in the reader menu

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-039, UI-012
- Blocks: —

## Spec References
- SPEC.md §7 (archived skills "restorable"), §11 (reader ⋯ menu)

## Summary
Wave-3 audit SPEC 34: the reader menu offers Archive with no inverse — unarchiving is
CLI-only, while the *broken* transition (status flip without the folder move) was
UI-reachable until SERVER-039 closed it server-side. Add Unarchive to the doc action
source (menu/docActions.ts — one declaration, both presentations pick it up) for
archived documents, calling the existing unarchive route. Availability mirrors
Archive's; no confirm (reversible act).

## Acceptance Criteria
- [ ] Archived doc's ⋯ menu and context menu offer Unarchive; non-archived docs don't
- [ ] Skill docs: folder moves back, name freed (the SERVER-036 409 case recoverable from the UI)
- [ ] SERVER-039's write-boundary refusal no longer reachable from the frontmatter form (status select disabled or redirected to the affordance on archived docs)

## Technical Design
### Files to Create/Modify
- apps/ui/src/menu/docActions.ts (+ tests), reader FrontmatterForm guard

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e case in the menu spec.

## E2E Verification Plan
Real app: archive a skill → unarchive from the menu → create-409 gone; frontmatter form cannot produce the half-state.

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
