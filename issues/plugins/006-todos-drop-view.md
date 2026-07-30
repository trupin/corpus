# [PLUGINS-006] Todos drops its View: core editor renders items, anchors apply

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: — (closes PLUGINS-003 together with PLUGINS-007)

## Spec References
- SPEC.md §12 as amended by SHARED-005; §6 (anchors); §15 M6

## Summary
Second leg of the PLUGINS-003 design: remove the todos plugin's `View` registration so
`anchorsHost` becomes true and the core TipTap editor renders the GFM task-list body —
checkboxes, editing, and the entire anchor layer (comment-from-selection on an item
line, highlight, margin cards, reconciliation across check/rename/reorder/delete)
with no new machinery. Delivers sprint-016 TEST-461–464. Includes the first
`apps/ui/e2e/` todos spec plus the manual drill; any task-list round-trip or capture
defect found is filed as the contingent UI issue the design anticipates, not fixed
in-plugin.

## Acceptance Criteria
- [ ] `View` gone; `ListItem`/`DocPanel`/`validate` remain (the docTypes seam still proven per SHARED-005 answer 3)
- [ ] Item-level comment: select item text → thread anchored to it; anchor survives check/uncheck, rename (reconciles), reorder; delete orphans per §6
- [ ] §15 M6 delete/restore drill still green
- [ ] e2e spec landed; evidence two-part (DOM + disk/git)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos + apps/ui/e2e scoped.

## E2E Verification Plan
Real server + browser (CORPUS_SERVER_ORIGIN exported and proven; never 8765); scratch under the job tmp dir.

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
