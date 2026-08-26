# [AGENT-055] Do not launch onto an agent that is working

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: CLI-071, SERVER-157
- Blocks: —

## Spec References

- SPEC.md §7 — the Orchestrator skill paragraph, rider signed 2026-08-25

## Summary

AGENT-053 gave the orchestrator its launch rule: a lane that is **not live** with
**work pending** wants a listener. That rule is right and it is one field short.

**A resident working its conversation inline holds no park.** §7 says so, and the
converse skill tells a resident to await what it launches rather than park on it
— so a turn longer than the grace window is *designed behaviour*, and while it
runs the lane reads exactly like a dead one. With a message queued behind that
turn, the orchestrator launches a second listener onto an agent that is busy.

The skill currently answers this by tolerating the duplicate: *"a duplicate
resolves itself at the first message, so launching costs a wasted session,
occasionally."* That reasoning was sound while nothing better was available.
SERVER-157 makes something better available.

## Acceptance Criteria

- [ ] The launch rule reads all three fields: **not live**, **something
      pending**, and **not working**
- [ ] The text says why the third is not the same question as the first, in the
      terms §7 uses — presence is the parked request, and a resident spends most
      of its time not parked
- [ ] **The tolerance for duplicates survives as the fallback position**, not as
      the rule. A lane that is not live, has work, and is not working is still a
      launch, and the first contested claim still settles a duplicate — because
      `working` can be stale for the same reason `live` can
- [ ] **It must never suppress a launch onto a genuinely dead lane.** A listener
      that died mid-event leaves its event held, so the lane reads `working:
      true` until `reap-stale` requeues it. The skill states that bound and says
      what closes it, because a rule that silently waits forever is worse than a
      duplicate
- [ ] The worked example shows the three-field row

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch bullet, and
  the "a row that does not read `live`" bullet that argues the tolerance
- `scripts/workspace-template.test.ts` — the pins on both

### Key Implementation Details

**Do not delete the duplicate-tolerance argument.** It is still the reason a
launch goes out under uncertainty, and it is what stops a future editor
reintroducing a probe. What changes is that one source of uncertainty now has an
answer, so the argument covers a smaller set of cases and should say so.

**No SPEC.md citations** — this file ships into a user's workspace, which has no
SPEC.md (found in AGENT-053).

## Testing Strategy

Prose. A grep sweep and a walk of the launch rule against the three states it
must now tell apart: dead-with-work, busy-with-work, and idle.

## E2E Verification Plan

Real workspace: claim an event on a designated lane without settling it, let the
park lapse, run a pass, and confirm no second listener goes out. Then settle it
and confirm one does.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-055]` prefix
