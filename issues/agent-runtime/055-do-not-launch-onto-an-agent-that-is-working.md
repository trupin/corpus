# [AGENT-055] Do not launch onto an agent that is working

## Domain

agent-runtime

## Status

done

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

- [x] The launch rule reads all three fields: **not live**, **something
      pending**, and **not working**
- [x] The text says why the third is not the same question as the first, in the
      terms §7 uses — presence is the parked request, and a resident spends most
      of its time not parked
- [x] **The tolerance for duplicates survives as the fallback position**, not as
      the rule. A lane that is not live, has work, and is not working is still a
      launch, and the first contested claim still settles a duplicate — because
      `working` can be stale for the same reason `live` can
- [x] **It must never suppress a launch onto a genuinely dead lane.** A listener
      that died mid-event leaves its event held, so the lane reads `working:
      true` until `reap-stale` requeues it. The skill states that bound and says
      what closes it, because a rule that silently waits forever is worse than a
      duplicate
- [x] The worked example shows the three-field row

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

Implemented by the orchestrator on opus, 2026-08-26.

### Three fields, each with the failure it prevents

The rule now names all three and says what leaving each out costs:

- **Not live** alone launches for every idle conversation in the workspace.
- **Something pending** alone would have you launch for a healthy quiet lane.
- **Not working** is the one easy to leave out and the one that costs an agent:
  a resident working inline holds no park, so a long turn reads exactly like a
  dead lane and the launch puts a second listener on a conversation already
  thinking.

`lapsed · working · 2 waiting` is named in the text as **a busy agent**, because
that row looks like a contradiction and is the case the field exists for.

### The argument was narrowed, not reversed — which is the whole delicacy

*"A row that does not read `live` does not mean nobody is there — and you launch
anyway"* was correct and stays. `working` answers **one** of the three things a
not-live row could mean. A crashed listener and one unobserved since a restart
are still indistinguishable, and still want the same thing.

So the bullet says which uncertainty went and, at length, that **everything the
old argument forbade it still forbids**: no probe, no holding back a pass to see
what happens, and above all no reading the display line after the state. A rule
that answers one uncertainty is exactly where somebody starts inventing
separators for the rest.

And the asymmetry that decides it is restated in v0.23.0's terms: a wasted
session against an unanswered conversation is not a close call. A test pins that
sentence, because it is the reason the tolerance survives at all.

### The bound, and where it is closed

`working` outlives a dead agent — a listener that died mid-event leaves its event
held until `corpus queue reap-stale` returns it. That is the one way this rule
could wait forever, so the text says so **and** says what closes it: the reap is
step 2 and the roster read is step 3, so the roster you decide from has already
had its stale work returned.

### Falsification

Dropping the third field from the rule:

```
× launches once per lane per pass, and stops when a launch does not take
  Tests  1 failed | 502 passed
```

### No SPEC.md citations

`grep -c "SPEC.md"` → 0. This file ships into a user's workspace, which has none
(AGENT-053's finding).

### Checks

```
vitest run scripts/workspace-template.test.ts   503 tests passed   exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[AGENT-055]` prefix
