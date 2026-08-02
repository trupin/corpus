# [SERVER-050] Upgrade endpoints: check proxy + detached upgrade trigger

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-027, CLI-025
- Blocks: UI-035

## Spec References
- SHARED-007 rider

## Summary
Implement CONTRACT-027. Check: fetch the latest release from GitHub on demand
(no background polling, no cache beyond the request), compare with the running
server's version, answer honestly on network failure. Trigger: spawn the
installed `corpus upgrade` as a DETACHED process (own process group, stdio to a
log under `.corpus/`) so the upgrade survives the server it will restart; answer
202 immediately. The server does not attempt to replace itself in-process —
the CLI owns download/verify/install/restart per CLI-025. Guard: refuse a
second trigger while one is in flight (pidfile or equivalent under `.corpus/`).

## Acceptance Criteria
- [ ] Check returns installed/latest/upgradeAvailable/notesUrl; unreachable
      GitHub → the modeled failure shape, not a 500
- [ ] Trigger spawns detached, logs to a discoverable path, answers 202
- [ ] Double-trigger refused while an upgrade is in flight
- [ ] The spawned upgrade actually survives the server's own restart (proven
      in the E2E log)

## Technical Design
### Files to Create/Modify
- `apps/server/src/upgrade/` (routes + spawn + guard), app wiring

## Testing Strategy
Route tests with injected fetch/spawn; a real-spawn test proving detachment
(child outlives a killed parent) without performing a real install.

## E2E Verification Plan
Real server: check against real GitHub; trigger with the CLI stubbed to a
script that sleeps past a server restart and logs.

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
