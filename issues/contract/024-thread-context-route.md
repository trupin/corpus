# [CONTRACT-024] Route: GET /api/threads/{id}/context (bounded pack)

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: SERVER-047, CLI-021

## Spec References
- SPEC.md §9.2 context bullet (SHARED-006 Edit 9), §7 context packs (Edit 4)

## Summary
The context-pack schema: anchored passage + enclosing section from the parent
(whole-document thread → parent title + opening content; standalone → no parent
block), plus ranked related excerpts (id, heading path, short excerpt, relation).
Total size bounded by contract — the schema carries the bound (max excerpt count and
per-excerpt length) so "a briefing, never a dump" is enforceable at the type level,
not a server courtesy. Read-only, no acting party.

## Acceptance Criteria
- [ ] Route in `ENDPOINT_INVENTORY`; §9.2 spelling exact; inventory test green
- [ ] Pack schema distinguishes the three parent cases; bounds encoded in the schema (length/count caps)
- [ ] openapi.json + client regenerated, drift check green

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/threads.ts` (context route + pack schema), `inventory.ts`, regenerated artifacts

## Testing Strategy
packages/contract scoped: schema round-trips incl. bound violations rejected, inventory equality.

## E2E Verification Plan
Build + drift check green; client exposes the typed method.

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
