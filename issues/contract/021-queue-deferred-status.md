# [CONTRACT-021] Rider: queue deferred-status surface for SERVER-030

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-002 (queue surface)
- Blocks: SERVER-030

## Spec References
- SPEC.md §7 — deferral wording (amended; the end-state SERVER-030 implements)

## Summary
Sprint-015 Open Conflict 5: SERVER-030 (honest queue defer/requeue) cannot ship
server-only — the job/event status enum lives in `packages/contract` and the console UI
renders from it. Define the wire surface for the deferred state: the status enum value,
any transition metadata the amended §7 requires (reason, retry linkage), and what
`corpus job retry` / `queue` verbs read. Scope exactly to what SPEC §7's amended
deferral paragraph describes — no speculative states. Note: the §7 clauses this spends
are in SHARED-004's sign-off set (item 7); coordinate wording, don't touch SPEC.md.

## Acceptance Criteria
- [ ] Deferred status + metadata modeled per amended §7; existing statuses untouched
- [ ] openapi.json + client regenerated; strictness/enum tests per house pattern
- [ ] Consumer impact enumerated in the log (server handlers, console rendering, CLI verbs) so SERVER-030 and any UI/CLI riders are filed with real scope

## Technical Design
### Files to Create/Modify
- `packages/contract/src/` queue/job schemas + routes (+ tests), regenerated artifacts

## Testing Strategy
Schema/enum tests; generation idempotence.

## E2E Verification Plan
Typecheck across consumers (server may temporarily need exhaustiveness-case handling — coordinate commits like the CONTRACT-019/SERVER-034 pairing if a switch breaks).

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
