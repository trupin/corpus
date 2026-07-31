# [CONTRACT-023] Routes: index status/rebuild; search staleness flag; `similar` rows live

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
- Blocks: SERVER-045, SERVER-046, CLI-020

## Spec References
- SPEC.md §9.2 index bullet (SHARED-006 Edit 10), §9.1 verbs bullet (Edit 6)

## Summary
Phase B's contract surface, all additive against CONTRACT-022's frozen shapes:
- `GET /api/index/status` — indexed/pending/failed counts, recorded provider/model
  identity, rebuild-in-progress flag.
- `POST /api/index/rebuild` — returns immediately (202-style), no acting party, no
  body; progress observable via status.
- Search response: the semantic-state field gains its Phase B values (current /
  catching-up / lexical-only) — documented, not shape-changed.
- Related rows: `similar` and `both` relation literals become producible (already in
  the enum since CONTRACT-022).
Inventory additions must match §9.2's applied spelling exactly.

## Acceptance Criteria
- [ ] Both routes in `ENDPOINT_INVENTORY`; inventory test green
- [ ] Status schema as above; rebuild is fire-and-forget with an honest response type
- [ ] No breaking change to any CONTRACT-022 shape (client compiled against A-era types still typechecks — assert in a test)
- [ ] openapi.json + client regenerated, drift check green

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/index-maintenance.ts` (new — avoid clashing with the barrel `index.ts`), `search.ts` (state values), `inventory.ts`, regenerated artifacts

## Testing Strategy
packages/contract scoped: inventory equality, schema round-trips, A-compat type assertion.

## E2E Verification Plan
Build + drift check green; generated client exposes both new methods typed.

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
