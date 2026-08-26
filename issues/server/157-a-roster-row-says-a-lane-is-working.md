# [SERVER-157] A roster row says a lane is working

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-057
- Blocks: CLI-071, AGENT-055, UI-176

## Spec References

- SPEC.md §7 — "Presence is the parked request, and nothing else"

## Summary

Implements CONTRACT-057's server half. `AgentLane.live` is false for three
different situations and a reader cannot tell them apart: a listener that
crashed, one the server has not observed since it restarted, and **a listener in
the middle of a turn**.

**The third stopped being cosmetic in v0.23.0.** AGENT-053 has the orchestrator
launch a listener for a lane that is `pending > 0 && !live` — and a resident
working its conversation inline holds no park, so a long turn with a message
queued behind it looks exactly like a dead lane. The orchestrator launches a
duplicate onto an agent that is simply busy.

The roster already computes the distinction and renders it into `summary`, whose
contract text forbids deciding from it. This lifts it into a field.

## Acceptance Criteria

- [x] Every roster row carries `working`, derived from the lane's held work —
      the same read `workSummary` already makes
- [x] `live` is unchanged and keeps its meaning exactly
- [x] `{live: false, working: true}` is representable and is the state the whole
      issue is about
- [x] It is computed in the **same pass** as `pending`, not a query per row
- [x] Test: a lane holding an in-progress event reads `working: true` with
      `live: false`, which is the resident mid-turn
- [x] Test: a lane holding nothing reads `working: false`
- [x] **Falsified**: hard-coding `working: false` turns the mid-turn test red

## Technical Design

### Files to Create/Modify

- `apps/server/src/agents/roster.ts` — beside `pendingByLane`, in the same pass
- `rosterSignature` — it moves with a write, so it belongs in the signature for
  the reason `pending` did (SERVER-155): a fact the orchestrator decides from
  and nobody announces is a fact nobody reads

### Key Implementation Details

`workSummary` already reads `events.status = 'in-progress'` per lane. Group it
once, as `pendingByLane` does, and index both off one pass.

**A lane holding work is not evidence a listener is alive.** A listener that died
mid-event leaves its event held until `reap-stale` requeues it. The field bounds
a launch decision; it does not assert presence, and its description must say so.

### Edge Cases

- The orchestrator's own lane carries a real value like any other.
- A stale held event: `reap-stale` returns it to pending, at which point the lane
  reads `working: false` with `pending > 0` — which is a launch, correctly.

## Testing Strategy

As above, plus a check that the count and the flag come from one pass.

## E2E Verification Plan

Real server: designate, park a listener, claim an event on that lane without
settling it, let the park lapse, and confirm the row reads `live: false` with
`working: true`.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26.

### One more pass over the same table, and into the same signature

`workingLanes` sits beside `pendingByLane` and runs once before any row is
built — a `SELECT DISTINCT lane … WHERE status = 'in-progress'`, which is the
read `workSummary` was already making per row and rendering into prose.

It goes into `rosterSignature` for the reason `pending` did: the orchestrator
decides from it, and a fact nobody announces is a fact nobody reads. **The
direction that costs most is the one worth naming** — a stale `working: true`
leaves a finished lane looking busy, and a listener that should have started
does not.

### The pair, and its converse

A resident claims its own work and goes quiet, which is what working inline looks
like from outside — it holds no park while it thinks. Past the grace window the
row reads `{live: false, working: true}`, which is the state the field exists
for. Settle the held event and it reads `working: false` with the work still
pending, which is a launch. Both are tested, because the second is what stops the
field being read as presence and suppressing a launch onto a genuinely dead lane.

### Falsification

Hard-coding `working: false`:

```
× tells a resident mid-turn from a dead lane, which `live` alone cannot
  Tests  1 failed | 32 passed
```

### Checks

```
vitest run apps/server            205 files, 4691 tests passed   exit 0
eslint apps/server/src                        0 problems         exit 0
tsc --noEmit -p apps/server                                      exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[SERVER-157]` prefix
