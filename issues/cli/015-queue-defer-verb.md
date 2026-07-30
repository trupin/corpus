# [CLI-015] `corpus queue defer` verb

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-004, CONTRACT-021, SERVER-030
- Blocks: AGENT-007

## Spec References
- SPEC.md §7 — locks bullet (as amended 2026-07-30): a deferred edit re-enters the queue automatically when the lock clears

## Summary
SERVER-030's escalation (2026-07-30): `POST /api/queue/{id}/defer` is live but no CLI
verb reaches it, so the product agent cannot actually defer — AGENT-007 (orchestrate
skill uses defer instead of the interim fail-with-`deferred:`-prefix protocol) is
blocked on this. Thin client per the queue-verb conventions (CLI-004):
`corpus queue defer <id> --blocked-on <docId> [--reason <text>]`, surfacing the
server's 409 (only in-progress events defer) and 404 per the CLI's error conventions;
`--json` passes the event through. Regenerate docs/cli.md.

## Acceptance Criteria
- [ ] Verb wired per the registry conventions; required `--blocked-on` validated locally (usage error, no request), reason optional
- [ ] 409/404 surface as exit 5 with the server's message; success prints the deferred event (human) / envelope (`--json`)
- [ ] docs/cli.md regenerated; hygiene inventories updated
- [ ] E2E: real server — claim an event, defer it, see `deferred` in `corpus queue status`, release the lock, watch it re-enter

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/queue/defer.ts` (+ test), queue index wiring, docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (subshell-cd init, ports 9180-9199, never 8765): full defer → auto-re-enter cycle through CLI verbs only.

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
