# [CLI-070] The roster does not print what is waiting

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-087, SERVER-155
- Blocks: AGENT-053

## Spec References

- SPEC.md §7 — the Orchestrator skill paragraph, rider signed 2026-08-25

## Summary

Found while writing AGENT-053, and it is the kind of gap only writing the
instruction finds.

Rider D has the orchestrator launch a listener for a lane that is **not live**
and **has work pending**, reading both off `corpus agents`. CONTRACT-087 put
`pending` on the wire and SERVER-155 fills it — and `renderLane` never printed
it. So the skill would have named a fact the surface does not show, leaving the
orchestrator to infer it from absence, which launches an agent for every idle
conversation in the workspace.

## Acceptance Criteria

- [x] A roster row prints its lane's waiting count
- [x] **Absent at zero**, not `0 waiting` — a roster is read by a person as
      often as by an agent, and a column of zeroes is a column nobody reads
- [x] It is a cell of its own, not folded into the presence cell: presence
      answers *is anybody there*, this answers *is anybody waiting*, and the
      launch decision needs both stated separately
- [x] The orchestrate skill's own worked example shows the pair

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/agents.ts` — `waitingCell`, joined after `presenceCell`
- `apps/cli/src/commands/agents.test.ts`

## Testing Strategy

A row with a count prints it; a row without one prints nothing. Falsify by
rendering `0 waiting` and watching the absence case fail.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25, inside AGENT-053's work.

The row now reads:

```
th_9f1a2b "Rate check" · analyst (doc_a7) · lapsed, last parked 41m ago · 3 waiting
```

That pair — not live, and something waiting — is the launch decision, and it is
legible to a person for the same reason it is usable by an agent.

### Checks

```
vitest run apps/cli              2129 tests passed   exit 0
tsc --noEmit -p apps/cli                             exit 0
```
