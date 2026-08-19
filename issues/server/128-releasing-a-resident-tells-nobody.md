# [SERVER-128] Releasing a resident tells nobody

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: — (needs a `resident.released` event type; file the CONTRACT half
  if the event shape reaches the wire)
- Blocks: —
- Related: SHARED-055, UI-125

## Spec References

- SPEC.md **§7** — designation, lanes, the lapse fallback, release
- SPEC.md **§7** — `resident.designated` as an enqueued event

## Summary

Reported by the user, 2026-08-19: *"Designating a resident sends an event to the
orchestrator agent, but releasing one does not. This means I don't have a way to
stop a resident agent without resolving the thread altogether or waiting for the
orchestrator agent to discover the resident status."*

Confirmed, and the asymmetry is documented as deliberate.
`apps/server/src/threads/resident.ts:112`:

> The `resident.designated` event; **`null` for a release, which enqueues none.**

So designating wakes the orchestrator and releasing tells nobody.

## What is milder than reported, and what is not

**The resident does find out.** `converse/SKILL.md:664` — a release that lands
while the resident is parked is read at the top of its next pass, and a refused
park is *"the same ending, found one step later"*. So a released resident does
exit on its own.

**But the window is the park rearm**, up to ~8 minutes (§7's bound). So *"stop
this agent"* is not an act with an observable end; it is a request that takes
effect at some point in the next eight minutes, with nothing to watch.

**And the orchestrator is never told at all.** A conversation whose resident was
released has no owner and nothing knows to pick it up. Nothing is broken — the
next message enqueues normally — but the gap between release and the next message
is unattended, and no surface reports it.

## What to decide

1. **Should release enqueue `resident.released`?** The draft assumption is yes,
   for symmetry with `resident.designated` and so the orchestrator learns a lane
   returned to it. Weigh against event volume on a workspace that designates and
   releases often
2. **Should release be immediate rather than next-pass?** This is the user's
   actual pain. A parked resident is blocked on an HTTP response — the same
   long-poll that makes parking free — so the server *can* return that request
   the moment a release lands, rather than letting it time out. That is a real
   design question about `queue idle`'s contract, not a bug fix
3. **What does a release event carry?** At minimum the thread and the released
   resident. Whether it carries the reason (released by a person, released by
   resolution, lapsed) decides whether the orchestrator can tell them apart

## Decided by the orchestrator, 2026-08-19

1. **Release enqueues `resident.released`** (CONTRACT-069 defines it), on the orchestrator's lane, payload `{threadId, resident, reason}` with `reason` one of `released | resolved | replaced`. A lapse is not a release and produces nothing. **Volume argument**: one event per release, and a release is a user-only act on one thread, so the bound is one event per designation-release cycle — the same as designation already costs. Nothing automatic releases in a loop.
2. **Release is immediate for a parked resident.** The parked scoped `queue idle` long-poll for that lane returns **at once** when a release lands, so the resident reads the release on its very next line rather than after the rearm. The idle response shape is unchanged — it returns as an ordinary wake, and the resident's own next read of its designation finds it released (converse already handles this). Bound: the HTTP round-trip, under a second. A resident mid-turn is not interrupted; it finds the release when it next parks or claims — events stamped for its lane before the release stay its to settle, unchanged.
3. **`replaced`** covers designating again over a live resident; the old one is released with that reason and the new designation's event follows.

## Acceptance Criteria

- [ ] Releasing a resident is observable — the orchestrator learns of it by the
      same mechanism designation uses, or by a stated deliberate alternative
- [ ] A release a person performs takes effect in a bounded, stated time, and the
      bound is short enough that "stop this agent" is an act rather than a wish
- [ ] Resolution-driven release and person-driven release are distinguishable, or
      the record says why they need not be
- [ ] **No event storm**: a workspace that designates and releases in a loop does
      not flood the queue. State the volume argument with a number
- [ ] The lapse fallback (§7) is unchanged — a lapsed lane is not a release, and
      conflating them would make a slow agent look like a stopped one

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — the `null` at line 112
- `packages/contract` — the event type, if it reaches the wire
- `apps/server/src/queue/` — if release is made immediate, `queue idle`'s return

### Key Implementation Details

Read `resident.ts:235` first — *"Every call enqueues `resident.designated`,
including one that writes…"* — which is the symmetry this issue is measured
against.

Read `converse/SKILL.md:659-700`. The skill already has a careful account of what
a resident does when it discovers a release mid-park, including that events
stamped for its lane before the release stay its to settle. **Any change here
must keep that true**, or work in flight is orphaned.

### Edge Cases

- A release landing while the resident is mid-work, not parked
- A release landing between claim and settle
- Resolution releasing a resident (§7) — the same path, different trigger
- Designating again immediately: one thread, two residents in succession, which
  `converse/SKILL.md:702` already treats as one lane with two occupants

## Testing Strategy

Route tests for the event, and a real-server test for the timing bound. Falsify
by restoring the `null` and confirming the release-observability tests go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Designate a resident, confirm `resident.designated` is enqueued
3. Release it; confirm the orchestrator learns, and **time how long it takes**
4. Repeat with the resident mid-work rather than parked
5. Confirm events stamped before the release are still settled by the resident
6. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-128]` prefix
