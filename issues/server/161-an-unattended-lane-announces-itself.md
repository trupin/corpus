# [SERVER-161] An unattended lane's arrival announces itself

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-093
- Blocks: AGENT-057

## Spec References

- SPEC.md §7 — **A lane that cannot be worked says so** (rider signed 2026-08-27)

## Summary

**User report, 2026-08-27:** _"When restarting the orchestrator agent, it does
not receive a message when a listener receives a message, which means it's not
aware that a listener agent might need to be spawned."_

SERVER-160 fixed the door where a conversation is **created**. Every later
message to that conversation is still silent: it is stamped with the
conversation's lane, `visibleTo` is exact equality, and `wake` reaches only lanes
the arrival is visible to — so the orchestrator neither sees it nor is woken by
it, and finds out only when its own park expires.

Restarting the orchestrator is the worst case and is how it was found: killing
the agent session kills every listener with it, while every conversation keeps
accepting messages that reach nobody.

## Acceptance Criteria

- [x] An event enqueued on a lane whose listener is **absent** also enqueues
      `lane.waiting` on the orchestrator's lane, naming that lane
- [x] An event on a lane whose listener is **present** enqueues no notice
- [x] An event on the orchestrator's own lane enqueues no notice — it is already
      the orchestrator's
- [x] A `lane.waiting` never enqueues a `lane.waiting` — no recursion
- [x] A parked `corpus queue idle` returns with the notice
- [x] The condition lives in **one named predicate**, so the unconditional
      reading is a one-line change (see SHARED-075)

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/service.ts` — `enqueue`
- `apps/server/src/queue/service.test.ts` — the four cases above

### Key Implementation Details

In `enqueue`, after the event is written and its own lane woken. It must be a
**second enqueue** and not a wake: `queue/waiters.ts` documents that a waiter
woken for work it cannot claim "re-reads its own lane, finds nothing, and parks
again without the HTTP request returning" — SERVER-160 measured exactly that, a
park holding 23 of its 25 seconds with a wake in place. Only a claimable event
ends the park.

Liveness comes from `this.laneTracker.isLive(lane)`, which is the same predicate
presence is published from — so the notice and the roster cannot disagree about
whether anybody is there.

**Name the predicate.** SHARED-075 records that the user asked for the notice
unconditionally and the rider took the cheaper reading; a single
`wantsListener(lane)` is what makes that reversible without a redesign.

### Edge Cases

- Two messages in quick succession on the same absent lane produce two notices.
  Acceptable — the launch rule is already "once per pass, per lane" — but say so
  in the docblock so the next reader knows it was considered
- The notice is enqueued **after** the conversation's own event, so a woken
  orchestrator reading the roster in the same pass sees the pending count
  already including it

## Testing Strategy

Against the real queue directory: the two lanes and their two event types, the
silent cases, and a parked `idle` returning.

## E2E Verification Plan

1. Real workspace, a designated conversation with no listener running
2. Park `corpus queue idle`
3. Post a turn to that conversation
4. Expected: the park returns at once with `lane.waiting` naming the lane

## E2E Verification Log

**Implemented on: opus.**

### Reproduction

Real workspace on 8795. A conversation created (which SERVER-160 announces
correctly), then a **later** message posted to it:

```
pending after the later message:
  comment.created        lane=th_am6bccbo
$ corpus queue claim-all --json
  claimed: []
```

One event, on the conversation's lane, and the orchestrator sees nothing — the
exact half SERVER-160 named as still open.

### Post-implementation verification

```
$ corpus queue idle --wait 25 --json   (parked first, then a later message posted)
the parked orchestrator returned after 1s of a 25s window:
   lane.waiting -> {"lane": "th_am6bccbo"}

pending:
  lane.waiting           lane=orchestrator
  comment.created        lane=th_am6bccbo
```

### The recursion guard was wrong, and my own test caught it

The first version guarded only on the resolved lane: a notice takes the
orchestrator's lane, which `wantsListener` refuses. That is true **when routing
is right**, and routing is a scope lookup that reads the payload.

Eighteen tests broke and five of them **timed out at 5s** rather than failing.
The lane suite's helper answers one lane for every payload, so the notice was
routed to the *resident's* lane, where it wanted a listener, so it announced
again — until the test gave up. The "never announces an announcement" case I had
written for exactly this is the one that reported it.

Two guards now, and the second does not depend on the first:

- `laneFor` sends `lane.waiting` to the orchestrator by **type**, beside the two
  resident announcements that were already carved out that way. The notice is
  *about* a lane, so any rule that read its payload could route it back to the
  lane it names.
- `enqueue` refuses to announce for any announcement, checked on the type.

### What the eleven remaining failures were, and why they were right to fail

Not the notice being wrong — the lane suite constructs precisely the situation
the rider is about: an event on a resident lane with nobody listening. Those
tests are about **routing**, and they had never had to say who was listening
because nothing depended on it.

They say so now, which every one of them meant anyway: a scoped claim seeing only
its own lane is a statement about a conversation somebody is answering. Two of
them are genuinely about an absent lane and were changed to assert the **lane**
rather than a count — *the orchestrator sees nothing of this lane* is what their
own comments already claimed, and it is now what they check.

### Suites

```
$ vitest run apps/server/src/queue/service.test.ts
   Tests  102 passed (102)
```

## Completion Checklist (domain agent)

- [x] Reproduced the silence before the fix
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
