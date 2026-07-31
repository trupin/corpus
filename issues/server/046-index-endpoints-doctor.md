# [SERVER-046] Index status/rebuild endpoints; rebuild queueing; doctor drift-vs-staleness

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-044, CONTRACT-023
- Blocks: CLI-020

## Spec References
- SPEC.md §9.1 verbs bullet (SHARED-006 Edit 6), §9.2 index bullet (Edit 10), §14 doctor bullet (Edit 13), §2.2 rule 1 (Edit 2)

## Summary
Wire Phase B's operational surface:
- `GET /api/index/status` from SERVER-044's counters + recorded identity + rebuild flag.
- `POST /api/index/rebuild`: discard vectors/marks, re-pick the current default
  identity (the one place stickiness resets), queue everything, return immediately.
- `db rebuild` (existing) queues semantic re-indexing after its synchronous work.
- `db doctor` extends per the signed drift-vs-staleness rule: FAIL on drift (chunk
  rows not matching files, mixed identity), stay clean on pending-only; `rebuild &&
  doctor` clean immediately, embeddings still draining.

## Acceptance Criteria
- [ ] Status counts live and accurate under a draining worker; rebuild is fire-and-forget and observable
- [ ] `index rebuild` re-picks identity; `db rebuild` keeps identity and queues re-index
- [ ] Doctor: seeded drift fixture fails with a named reason; pending-only workspace passes; mixed-identity fixture fails
- [ ] `rebuild && doctor` green while pending > 0 (the invariant test)

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/routes.ts` (new), `apps/server/src/projection/` doctor pass extension, rebuild hook

## Testing Strategy
apps/server scoped: endpoint tests over stubbed worker state; doctor fixture matrix.

## E2E Verification Plan
Real server: `curl` status mid-drain; `POST rebuild` then watch counts reset and drain; `corpus db doctor` (existing CLI) clean while pending.

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
