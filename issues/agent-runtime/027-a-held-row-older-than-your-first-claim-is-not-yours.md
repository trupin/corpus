# [AGENT-027] The converse skill can still adopt work the orchestrator is holding

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: AGENT-025, AGENT-026 (which closed the other half)
- Related: SHARED-047

## Spec References

- SPEC.md **§7** — lanes, the lapse fallback, and reconciliation
- SPEC.md **§7** — *"the agent can see what the server still thinks it is doing"*

## Summary

`AGENT-026`'s drill found a real defect and fixed the half the orchestrator
controls. **The other half is still open, and it is the same failure.**

The defect, in `AGENT-026`'s own measurement: a listener launched for a lapsed
lane parked, the lane went live, and its **first scoped claim reported the
orchestrator's in-flight event in `inProgress`**. The converse skill's
reconciliation then did that work and completed the orchestrator's event. Two
agents answered one message, and **nothing anywhere reported an error** — both
behaved exactly as written.

`AGENT-026` closed the path it owns: *per lane, per pass, take the work or launch
the listener, never both.* That covers every listener the orchestrator starts.

**It does not cover a listener that starts any other way** — a person
re-designating a thread, or starting `/converse` by hand, while the orchestrator
is holding that lane's work under fallback. The orchestrator cannot prevent
that, and the converse skill currently adopts anything its first claim reports
as in-progress.

## What the converse skill must learn

`AGENT-026` states the rule it needs, and it is worth quoting because it is the
whole fix:

> a held row older than your first claim on this lane is not yours.

An event the server reports as `in-progress` when a resident has only just
started parking was claimed by somebody else — necessarily, because the resident
had claimed nothing yet. Reconciliation exists to recover a resident's *own*
interrupted work, not to adopt whatever the lane happens to be holding.

## Acceptance Criteria

- [ ] `assets/workspace/claude/skills/converse/SKILL.md` distinguishes work this
      listener claimed from work it merely found in progress, and adopts only
      the former
- [ ] The reasoning is stated, not just the rule — a later editor who reads
      "reconcile what is in progress" as an obvious simplification would
      reintroduce exactly this defect, which is how it arrived
- [ ] The rule does **not** break the case reconciliation exists for: a resident
      that crashed mid-event and comes back must still recover its own work.
      Say how the two are told apart, and test it
- [ ] Drilled for real: start a listener by hand while the orchestrator holds
      that lane's work under fallback, and show the listener declining it. A
      unit test cannot show two agents not colliding

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `scripts/workspace-template.test.ts`

### Notes

`AGENT-026` measured that `inProgress` is per-lane and that the orchestrator's
held view *does* include a lapsed lane's work under fallback
(`apps/server/src/queue/held.ts` documents that deliberately). Both facts are
load-bearing here.

## Testing Strategy

Template tests for the text. The real test is the drill: two live processes and
one event, showing it answered once.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] E2E verification log filled
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-027]` prefix
