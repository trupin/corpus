# [UI-176] The pending row reads the lane instead of walking to it

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-156, SERVER-157
- Blocks: —

## Spec References

- SPEC.md §7 — the two lane carve-outs

## Summary

Two readings in `PendingIndicator.tsx` that the server can now answer.

**The lane.** The row derives which lane holds an event by walking the scope, and
the walk is wrong for exactly the two cases §7 carves out — a
`resident.designated`, which takes the orchestrator's lane whoever is designated,
and a message that named a recipient. UI-109 saw the first live: for the seconds
after designating a thread, the card reads *"waiting for researcher"* about an
event **the orchestrator holds**. SERVER-156 puts the stamped lane on the job.

**Working.** With SERVER-157 the row can tell a resident mid-turn from a dead
one, which is the difference between *"researcher is working"* and *"researcher
is not running"* on the surface a person watches while they wait.

## Acceptance Criteria

- [x] The row reads the job's `lane` and does not walk the scope
- [x] UI-109's scope-walk fallback is removed, and the docblock explaining why it
      was there goes with it — a comment describing a workaround that is gone is
      a comment that will be re-obeyed
- [x] A `resident.designated` reads as the orchestrator's, which is the case that
      was visibly wrong
- [x] A lane that is `working` reads as working rather than as absent, and the
      wording is `laneRows`', not a fourth phrasing
- [x] Nothing about the row's geometry changes (§10)

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/PendingIndicator.tsx` — the lane read, the working branch,
  and the head docblock
- `apps/ui/src/thread/outstandingAgentRequest.ts` — whatever supplies the lane

## Testing Strategy

The two carve-outs, read from the job rather than walked. Falsify by restoring
the walk and watching the designation case go wrong again.

## E2E Verification Plan

Real app: designate a thread and watch the card during the seconds before the
event settles. It must not name the resident.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26.

### The lane comes off the job

`ThreadCard` called `useResidentLane(threadId)` — the scope walk — and now calls
`useLaneRow(outstanding?.job.lane)`. One line, and the docblock that explained
why the walk was there is replaced by the reason it is gone.

`undefined` while nothing is outstanding, which is also when the row is not
drawn, so nothing asks the roster about a lane nobody is waiting on.

### Two wording changes, and the second is the one worth reading

**A working lane is not away.** `laneAwayClause` returns null for it, because a
resident mid-turn holds no park and the row would otherwise say *its agent is
not running, nothing will answer until it starts* — about an agent that is
answering. That is the most misleading sentence this row could produce, and
UI-175 had just made it worse by removing the softening promise.

**A working resident is named.** The test was `liveness === "live"`, justified by
the fallback: a claim on an away lane might have been taken by the orchestrator,
so the resident was named only where the claim was certainly theirs. Nobody else
can hold this lane now, and `working` states the fact presence was
approximating. Before this, a resident thinking longer than the grace window
fell through to the workspace-grained line and **stopped being named at all** —
at exactly the moment a person most wants to know who is on it.

### One asymmetry, decided rather than defaulted

`unknownLaneRow` carries `working: false`, not an unknown. The field only ever
**withholds** — a launch, or an absence sentence — so not knowing must not
withhold. Written into the code, because the opposite reading is the plausible
one and it fails silently.

### Falsification

Removing both branches:

```
× says nothing about absence for a lane that is holding work
× names a resident that is working, even on a lane presence calls away
  Tests  2 failed | 37 passed
```

### Checks

```
vitest run apps/ui/src + packages/kit   243 files, 4735 tests passed   exit 0
eslint apps/ui/src packages/kit/src              0 errors              exit 0
tsc --noEmit (ui, kit)                                                 exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[UI-176]` prefix
