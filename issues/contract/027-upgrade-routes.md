# [CONTRACT-027] Upgrade routes: check + trigger

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007
- Blocks: SERVER-050, UI-035

## Spec References
- SHARED-007 rider

## Summary
Two routes for the UI's on-demand upgrade flow. `GET /api/upgrade/check`:
`{installed, latest, upgradeAvailable, notesUrl}` (server proxies GitHub on
demand; no caching semantics in the contract beyond an honest fetch).
`POST /api/upgrade` → 202 `{started: true}` — the server spawns the detached
CLI upgrade; the restart itself is observed by the client as the SSE drop and
reconnect, not modeled in this response. Error shapes follow the house
envelope; a check that cannot reach GitHub is a described failure, not a 500.

## Acceptance Criteria
- [ ] Both routes defined in zod-openapi with strict schemas; openapi.json and
      the generated client regenerated (drift-checked)
- [ ] Unreachable-GitHub check response modeled explicitly
- [ ] 202 semantics documented on the trigger route

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/upgrade.ts` + schemas, inventory, index; the
  generated artifacts

## Testing Strategy
Route/schema tests matching house patterns (see routes/*.test.ts).

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
