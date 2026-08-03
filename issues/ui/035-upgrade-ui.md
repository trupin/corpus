# [UI-035] Upgrade UI: on-demand check + "Upgrade & restart" with SSE ride-through

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-027, SERVER-050
- Blocks: —

## Spec References
- SHARED-007 rider

## Summary
On-demand only: a "Check for updates" affordance (console/health area — match
where the version already surfaces); on `upgradeAvailable`, show latest version
+ notes link and an "Upgrade & restart" action calling `POST /api/upgrade`.
The UI then rides the restart with the existing SSE reconnect machinery: show
an upgrading state while the connection is down, and on reconnect show the new
version (re-fetch whatever carries it). Never check without the user asking.

## Acceptance Criteria
- [ ] Check runs only on explicit user action; result states current vs latest
- [ ] Upgrade action visible only when a newer release exists; disabled with
      an honest message when the trigger answers the in-flight refusal
- [ ] SSE drop after trigger renders an upgrading state, not the generic
      unreachable-server error; reconnect restores the board and shows the new
      version
- [ ] Unreachable GitHub renders the modeled failure, not a crash

## Technical Design
### Files to Create/Modify
- Console/health surface components + kit client methods/hooks per the
  generated client

## Testing Strategy
Component tests for all states (stubbed transport); e2e with a stubbed check +
a real SSE drop/reconnect.

## E2E Verification Plan
Real app: check → upgrade against a stubbed server-side trigger; observe the
ride-through.

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
