# [UI-176] The pending row reads the lane instead of walking to it

## Domain

ui

## Status

todo

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

- [ ] The row reads the job's `lane` and does not walk the scope
- [ ] UI-109's scope-walk fallback is removed, and the docblock explaining why it
      was there goes with it — a comment describing a workaround that is gone is
      a comment that will be re-obeyed
- [ ] A `resident.designated` reads as the orchestrator's, which is the case that
      was visibly wrong
- [ ] A lane that is `working` reads as working rather than as absent, and the
      wording is `laneRows`', not a fourth phrasing
- [ ] Nothing about the row's geometry changes (§10)

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

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-176]` prefix
