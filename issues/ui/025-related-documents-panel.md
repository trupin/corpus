# [UI-025] Related-documents panel beside backlinks

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-022, SERVER-041
- Blocks: —

## Spec References
- SPEC.md §11 document view (SHARED-006 Edit 12)

## Summary
Below the body, beside the backlinks panel: the ranked related set from
`GET /api/docs/:id/related` — each row title + why it is related (linked / similar /
both; `similar` appears only once Phase B serves it — the UI renders whatever the
route returns, no phase logic client-side). Clicking a row pushes onto the reader's
navigation stack like following a ref. Both hosts (column reader + focus mode) via
the shared DocView; TanStack Query with the standard invalidation keys; empty state
renders nothing (like backlinks).

## Acceptance Criteria
- [ ] Panel renders ranked rows with relation labels; click pushes the nav stack (Back returns)
- [ ] Present in both hosts; absent (not empty-boxed) when no related docs
- [ ] SSE invalidation refreshes it like backlinks

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/RelatedPanel.tsx` (new + tests), DocView wiring next to the backlinks panel, kit query hook if the pattern requires one

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e case in the reader spec (stubbed related payload).

## E2E Verification Plan
Real app: linked docs show the panel; click navigates with working Back.

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
