# [UI-040] Console strip: semantic-index pill with live progress

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-051
- Blocks: —

## Spec References
- SPEC.md §11 console index pill (rider signed 2026-08-02)

## Summary
User request (2026-08-02): surface background indexing in the UI like the
agent pill. Add an index pill to the collapsed console strip beside the agent
pill: state dot (reuse the agent pill's dot vocabulary) + text —
`index: current · 273 indexed` when caught up; `index: indexing · 41/68`
(indexed / indexed+pending) while draining or rebuilding; `index: stale · …`
same count shape; `index: disabled`. Expanded console shows the status row
with the server's `detail` sentence verbatim (never parsed) and the `failed`
count when non-zero. Data: `GET /api/index/status` via a kit method + hook,
refetched on the SERVER-051 invalidation key.

## Acceptance Criteria
- [ ] Pill matches the agent pill's visual conventions; all four states render
- [ ] Counts live-update during a drain without reload (SSE-driven)
- [ ] `detail` rendered verbatim in the expanded view when present; `failed`
      shown only when non-zero
- [ ] No polling loop — refetch on invalidation only
- [ ] Kit: method + hook + query key follow the retrievalHooks patterns

## Technical Design
### Files to Create/Modify
- Console strip/expanded components; `packages/kit` client method + hook +
  query key

## Testing Strategy
Component tests for all states + count formatting; kit hook tests; e2e with a
stubbed status sequence.

## E2E Verification Plan
Real app: trigger a rebuild via `corpus index rebuild`; watch the pill go
indexing → counts climb → current.

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
