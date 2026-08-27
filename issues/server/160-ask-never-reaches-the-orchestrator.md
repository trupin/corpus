# [SERVER-160] Pressing Ask tells the orchestrator nothing, so nobody answers

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-154 (the creation-time designation), SERVER-152 (the fallback
  this exposed), AGENT-053/AGENT-054 (the launch rule that had nothing to fire it)

## Spec References

- SPEC.md §7, rider A (signed 2026-08-25) — a new standalone thread designates a
  general resident, and *"a listener is started when its lane has something
  pending and none is running"*
- SPEC.md §7 — the `resident.designated` carve-out: it takes the **orchestrator's**
  lane whoever is designated

## Summary

**User report, 2026-08-27:** _"When I start a conversation with the 'ask/capture'
form, no event goes to the orchestrator agent, which means it is not aware of
what it needs to do. Regardless of whether the message should be handled by a
resident subagent or not, the orchestrator needs to be aware it needs to start
the subagent at the very least. FIX THIS… the product is unusable right now."_

They are right, and the failure is total rather than partial: a person presses
Ask and **nothing whatever happens**, for as long as the workspace runs.

## Why (reproduced, below)

Three correct decisions meet and leave a hole between them:

1. **A creation designates.** Rider A makes a new standalone thread designate a
   general resident, so its `comment.created` is stamped with the **thread's**
   lane (SERVER-154).
2. **The fallback is gone.** The same rider removed the lapse fallback, so
   `visibleTo` is exact equality — the orchestrator's unscoped `claim-all` can
   never see another lane's work (SERVER-152).
3. **The launch is the orchestrator's, lazily.** Rider A says a listener starts
   when its lane has work and none is running, and the orchestrator does that by
   reading the roster's per-lane `pending` count (AGENT-053, SERVER-155).

Nothing connects (1) to (3). The orchestrator learns what to launch by reading
the roster, and it reads the roster when it wakes — and the one event the
creation enqueues is on a lane it cannot see, so it never wakes.

**A wake alone would not fix it, and that matters for the shape of the fix.**
`queue/waiters.ts` documents that a waiter woken for work it cannot claim
"re-reads its own lane, finds nothing, and parks again without the HTTP request
returning". Measured: adding a wake for the orchestrator on every unattended
lane's arrival left the park held for its full window. **Only an event the
orchestrator can claim ends the park**, which is exactly what
`resident.designated` is carved out to be.

## Acceptance Criteria

- [x] A creation that asks for the agent enqueues `resident.designated` on the
      **orchestrator's** lane, naming the new thread
- [x] The conversation's own message still lands on the conversation's lane —
      routing is unchanged, and a resident's work is still never claimable by
      anybody else
- [x] A creation that asks for **no** agent announces nothing (rider A's own
      condition: a listener starts when its lane has something pending)
- [x] A thread with a parent announces nothing — it designates nobody
- [x] A parked `corpus queue idle` returns with the announcement
- [x] The regression test asserts the **lane**, because the lane is the defect

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts` — the announcement
- `apps/server/src/threads/resident.test.ts` — the regression tests

### Key Implementation Details

Reuse `residentDesignatedPayload` and `RESIDENT_DESIGNATED` from
`threads/resident.ts` — the designate route's own announcement — rather than
composing a second one. `designationFor` has to be hoisted out of
`threadFields`, because the announcement needs it after the write and computing
it twice would mint two designation ids for one designation.

### Edge Cases

- No agent requested: designates a general resident, announces nothing
- A parented thread: designates nobody, announces nothing
- Capture: its thread has a parent, so it was never affected — its event has
  always landed on the orchestrator's lane by the ordinary rule

## Testing Strategy

Against the real app and the real queue directory: the two events, their two
lanes, and the two silent cases.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real workspace, real server
2. `POST /api/threads` with `requestsAgent: true`
3. Expected: the orchestrator learns a listener is wanted
4. Actual: one event, on the thread's lane, that nobody can claim

### Verification Steps

1. Park `corpus queue idle`, then press Ask
2. Expected: it returns at once with `resident.designated`

## E2E Verification Log

_Filled in by the implementing agent._

**Implemented on: opus.**

### Reproduction

Real workspace, real server on 8793, `POST /api/threads` with
`requestsAgent: true`:

```
thread created: th_g6e5za5p, resident.designationId = des_mzzkq2pnaqsg
pending events:
  comment.created   lane=th_g6e5za5p
$ corpus queue claim-all --json
  {"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
```

One event, on a lane the orchestrator cannot see, and the orchestrator's own
claim answers with nothing. A parked `corpus queue idle` held its **entire**
window and returned `{"idle":true,"reason":"timeout"}`.

The roster made it look survivable and was itself lying:

```
th_g6e5za5p "Rate assumption" · a general resident · waiting for a listener · 1 waiting
a lane with no listener is not a failure: past the grace window (16m) its pending
work becomes visible to the orchestrator's own `corpus queue claim-all` …
```

That footer describes the fallback the rider signed 2026-08-25 **deleted**. It
told the operator to wait sixteen minutes for something that was never coming.
Corrected under CLI-073.

### The attempt that did not work, and why it is worth recording

The first fix woke the orchestrator from `enqueue` whenever an unattended lane
gained work. It changed nothing, and `queue/waiters.ts` says why in its own
docblock: a waiter woken for work it cannot see "re-reads its own lane, finds
nothing, and parks again without the HTTP request returning". Measured with the
wake in place — the park still held 23 of its 25 seconds and returned `timeout`.

**Only an event the orchestrator can claim ends its park.** That is precisely
what the `resident.designated` carve-out exists to be, and creation was the one
door that designated without knocking.

### Post-implementation verification

```
$ corpus queue idle --wait 25 --json   (parked first, then Ask pressed)
the parked orchestrator returned after 0s of a 25s window:
   resident.designated -> th_ndiujuck

pending events:
  resident.designated   lane=orchestrator
  comment.created       lane=th_ndiujuck
```

Routing is unchanged: the message is still the conversation's, waiting for the
listener the announcement asks for.

### Falsification

Forcing the announcement off:

```
× announces the designation on the orchestrator's lane, beside the message
  1 failed | 100 passed
```

## Completion Checklist (domain agent)

- [x] Reproduced against a real server before any code changed
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
