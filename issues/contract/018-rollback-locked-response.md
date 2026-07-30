# [CONTRACT-018] Rider: `423` on the skill-rollback route + inventory docblock correction

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-008 (route exists), SHARED-002 (amendment applied)
- Blocks: SERVER-035

## Spec References
- SPEC.md §9.2 — routes + "document write paths refuse edits to a document locked by the other party"
- SPEC.md §7 — skill rollback "lands as a normal auto-commit … like any mutation"

## Summary
PR #11 review (finding 1, MAJOR): skill rollback is the only document write path whose
contract declares no lock-conflict response — every other mutating route carries
`423: LOCKED_RESPONSE` (`routes/docs.ts`, `routes/threads.ts`, `routes/thread-create.ts`).
The amended §9.2 makes no carve-out for rollback; CONTRACT-008's log shows the missing
423 was derived from this gap, not decided. This rider adds the response so SERVER-035
can enforce the guard. Also folds review finding 4 (MINOR): the
`routes/inventory.ts` docblock still claims §9.2 "does not yet name" the two new routes
and the amendment is "awaiting sign-off" — SHARED-002 applied it in this same PR
(SPEC.md:323-325), so the contract's spec-compliance record is now false.

## Acceptance Criteria
- [ ] `POST /api/skills/{name}/rollback` route definition declares `423: LOCKED_RESPONSE`, with description text matching the house style ("Refused with `423` when the other party holds the document's edit lock." — see `routes/docs.ts`)
- [ ] Route response-key test updated to include `"423"` (pattern: `thread-create.test.ts:252`)
- [ ] `routes/inventory.ts:2-9` docblock corrected: the §9.2 amendment is applied (SHARED-002, SPEC.md:323-325), not pending
- [ ] `openapi.json` regenerated; no other route's surface changes
- [ ] Generated client picks up the response type (typecheck across consumers passes)

## Technical Design

### Files to Create/Modify
- `packages/contract/src/routes/` — the rollback route definition (added by CONTRACT-008; locate the file defining `POST /api/skills/{name}/rollback`)
- `packages/contract/src/routes/inventory.ts` — docblock correction only
- `packages/contract/openapi.json` — regenerated
- colocated route tests

### Key Implementation Details
Mirror exactly how `routes/docs.ts` declares `423: LOCKED_RESPONSE` on doc mutations.
This is a declaration-only rider — no schema changes, no new types.

### Edge Cases
- None; additive response declaration.

## Testing Strategy
Update the route's response-key assertion test; regenerate and drift-check openapi.json.

## E2E Verification Plan

### Verification Steps
1. `npm run build -w packages/contract` then the OpenAPI generation script
2. Confirm `openapi.json` diff is exactly the one new `423` response entry
3. `npm run typecheck` passes in contract + consumers

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
