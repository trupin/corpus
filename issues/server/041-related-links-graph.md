# [SERVER-041] GET /api/docs/:id/related: links-graph expansion

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: CLI-019, SERVER-047, UI-025

## Spec References
- SPEC.md §9.2 related bullet (SHARED-006 Edit 8), §7 Retrieval discipline (Edit 4)

## Summary
Phase A `related`: rank documents connected to `:id` through the `links` table —
outgoing refs, backlinks, and (rank boost) mutual links. Row: id, title, one-line
excerpt (opening body line), relation `linked` (the `similar`/`both` literals exist in
the contract but are Phase B's). Archived excluded by default; 404 on unknown id;
ranking deterministic (mutual > backlink ≈ outgoing, tie-break by recency).

## Acceptance Criteria
- [ ] Outgoing, incoming, and mutual refs all surface; mutual ranks first; deterministic order
- [ ] Excerpts are single lines, never bodies; archived default + `includeArchived` behave like every list
- [ ] Unknown id → 404 through the contract error shape

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/related.ts` (new) + route wiring; reads `links` + `documents` only — no new tables

## Testing Strategy
apps/server scoped: fixture graph (chain, mutual pair, orphan, archived neighbor), ranking and default-exclusion cases.

## E2E Verification Plan
Real server: seed three linked docs, verify ranked rows + relation labels via curl; archived neighbor appears only with the flag.

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
