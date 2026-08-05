# [SERVER-060] A poll ticking mid-requeue reports half a batch as the whole of it

## Domain
server

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §7 — the queue's promise that a deferred edit "re-enters the queue
  rather than being lost", and that `queue idle` reports what is available.

## Summary
Split out of INFRA-020, which listed `requeueDeferredFor` alongside two genuinely
load-sensitive tests and asked the question the right way round: **establish
whether the test is racy or the code is, before fixing the test.** It is the
code.

`QueueService.idle` and the parked waiter's poll tick both answered "is there
work?" by scanning `pending/` **off** the writer chain, while
`requeueDeferredFor` moves and rewrites its files **one at a time on it**. A
reader landing between two of those writes saw one event and reported it as the
whole batch. With `pollIntervalMs` at its test value of 10 ms, a requeue doing
four file operations hits that window often; on a loaded gate it hits it
reliably — which is why the same assertion failed four times (2026-08-03,
2026-08-05 ×3), twice at *normal* test duration. A test that fails without
contention is not load-sensitive, and this one was telling the truth.

**Nothing was ever lost.** The unreported event stays in `pending/`, the agent's
loop is `idle → claim-all`, and `claimAll` takes the chain — so it claims both.
The next poll would return the straggler in any case. What broke is narrower and
still worth having: reporting availability is *all* these two entry points do,
and a torn read makes them wrong about it.

## Reproduction (pre-fix)
`apps/server/src/queue/service.test.ts` → "never reports a half-applied batch to
a poll that ticks mid-requeue". Forces the interleaving the 10 ms tick hits by
luck — a 60 ms delay between the two pending writes — so the failure is
deterministic rather than one-in-twenty:

```
AssertionError: expected [ 'evt_dqq74qll5umt' ] to deeply equal [ 'evt_dqq74qll5umt', …(1) ]
  at apps/server/src/queue/service.test.ts:599:61
```

That is the same shape as every one of the four gate failures.

## Acceptance Criteria
- [x] Diagnosed to a mechanism, not retried away
- [x] A deterministic regression test that fails before the fix and waits on the
      condition rather than on a duration
- [x] Both readers — the long poll and the waiter's probe — fixed, not just the
      one the test exercises
- [x] Verified under deliberate CPU load (6/6 with four spinners), because a
      green run on an idle box proves nothing here
- [x] No regression across queue, locks and jobs (266/266)

## Technical Design
### Files to Create/Modify
- `apps/server/src/queue/service.ts` — new private `settledPending()` wrapping
  `availablePending()` in `serialize()`; both `idle()` and the `WaiterRegistry`
  probe call it. `serialize`'s docblock updated: it is no longer "one writer at a
  time" but one *turn* at a time, writers plus the two readers that must not
  observe a partial one.
- `apps/server/src/queue/service.test.ts` — the regression test.

### Notes
- Taking the writer's chain for a read is the cheapest way to say *between*
  batches rather than *during* one. It cannot deadlock: `notify()` fires from
  inside a write's turn, but the woken reader only **queues** behind it.
- The cost is that a long poll's scan waits on an in-flight write. For a
  single-user app whose writes are a handful of file operations, that is not a
  cost worth engineering around.
- INFRA-020 keeps the other two entries (the rollback test's 5 s budget, the
  todos pointer spec) — those remain a load story.

## Testing Strategy
Deterministic unit reproduction, then repeat runs under deliberate CPU load
before and after.

## E2E Verification Log
Ran on **opus** (orchestrator, directly — the session's subagent limit was
reached).

- **Pre-fix, deterministic**: new test fails with one event where two were
  expected — the gate's exact signature.
- **Post-fix**: `apps/server/src/queue/service.test.ts` 57/57.
- **Under load**: 6 consecutive runs, 4 CPU spinners, 0 failures.
- **Regression**: `queue` + `locks` + `jobs` = 266/266.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
