# [UI-097] A request nobody has picked up says "agent is working…"

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 1 (signed)
- Blocks: —

## Spec References

- SPEC.md §8 line 340 — the honest pending indicator, as amended by SHARED-033
- SPEC.md §7 — queue event lifecycle: `pending` → `in-progress`

## Summary

Post a comment to the agent with no agent running, and the thread says **"agent
is working…"**, escalating to "still working…" and "still working — longer than
usual". Nothing is working. The event is `pending` in the queue and no agent has
ever seen it.

**No contract change is needed** — `pending` and `in-progress` are already
distinct on the wire and already reach the client. This is a UI issue that
conflates them.

## Reproduction (confirmed by inspection)

`packages/kit/src/row/useRowSignals.ts:25`:

```ts
const ACTIVE_JOB_STATUSES: readonly QueueEventStatus[] = ["pending", "in-progress"];
```

under the docblock *"Queue states that mean the agent is working on this row
right now."* `pending` means the opposite: unclaimed.

`apps/ui/src/thread/PendingIndicator.tsx:22` then opens at `"agent is working…"`
for any outstanding request, on a clock measured from the requesting turn.

## Acceptance Criteria

- [ ] A `pending` (unclaimed) request reads as **waiting to be picked up**, in
      wording clearly distinct from a request being worked
- [ ] An `in-progress` request reads as the agent working, exactly as today
- [ ] The transition `pending` → `in-progress` updates live over SSE, without a
      reload
- [ ] The **elapsed clock still runs from the requesting turn**, not from the
      claim — per the rider, "the wait is the wait". A request that sat pending
      for ten minutes and is then claimed must not reset to "0m"; the existing
      docblock at `outstandingAgentRequest.ts:222` already warns about exactly
      this reset and must not be undone
- [ ] The escalating tiers still apply, and their wording is coherent for a
      request that has been *waiting* rather than *worked* for 15 minutes — "still
      working — longer than usual" is wrong for something never started
- [ ] `deferred` keeps its current, separate treatment (`awaitingAgent`) —
      `useRowSignals.ts:20` explains why it is excluded from the active set, and
      that reasoning is untouched by this issue
- [ ] Row-level signals (the spinning dot in a list) obey the same split — a
      queue full of unclaimed work must not spin a dot on every row
- [ ] Applies everywhere an outstanding request is indicated: thread cards, board
      rows, Attention, and the Ask/Capture "appears immediately with a
      pending-agent indicator" path (§11)

## Technical Design

### Files to Create/Modify

- `packages/kit/src/row/useRowSignals.ts` — split the active set; the name
  `ACTIVE_JOB_STATUSES` becomes a lie the moment it holds only `in-progress`, so
  rename it to say what it means
- `apps/ui/src/thread/PendingIndicator.tsx` — a second wording set for the
  waiting case, alongside `WORKING_TIERS`
- `apps/ui/src/thread/outstandingAgentRequest.ts` — carry the claimed/unclaimed
  distinction out to callers; today it answers one boolean
- the row-signal consumers, wherever the dot is drawn

### Key Implementation Details

`outstandingAgentRequest` currently answers **whether** a response is
outstanding. It now has to answer **which kind**, and its existing docblocks
explain constraints that must survive the change: the status is asked on the
wire once for the thread (line 53), the check must not key off "any outstanding
job in the corpus" (line 105), and a saturated queue transitions constantly so
the row must not thrash (line 194).

The elapsed clock is the subtle part. It is measured from the turn deliberately,
so a reload mid-job does not lie about the wait. Splitting the *wording* must not
split the *clock* — one wait, two descriptions of who is holding it.

### Edge Cases

- A request claimed and then requeued by `reap-stale` — returns to waiting; the
  clock does not restart
- A request whose job is `deferred` — unchanged path
- Several outstanding requests on one thread at different statuses — the row
  reports the one that governs; decide and document which
- A request claimed within the first render — must not flash "waiting" first

## Testing Strategy

Vitest + Testing Library: a `pending` job renders the waiting wording and no
working dot; `in-progress` renders the working wording and the dot; the
transition re-renders without remounting; the elapsed value is computed from the
turn timestamp in both states and does not reset across the transition;
`deferred` takes its existing path.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the server with **no agent running** (`corpus server start`, no
   `claude` session)
2. Post an `@agent` comment in the UI
3. Expected: the thread says the request is waiting to be picked up
4. Actual: "agent is working…", escalating to "still working…"

### Verification Steps

1. Restart the app, still with no agent running; post an `@agent` comment
2. Confirm the thread reads as waiting, and that no row spins a working dot
3. Leave it past 45 s and 3 m — confirm the escalation wording is coherent for
   something that has not started
4. Now start the agent (`corpus queue idle` / the orchestrate loop) and let it
   claim the event
5. Confirm the indicator switches to working **live over SSE**, and that the
   elapsed time **continues** from the original turn rather than resetting
6. Confirm the same behaviour on a board row and in Attention
7. Fill the queue with several unclaimed events — confirm no row shows a working
   dot

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Pre-fix reproduction logged
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-097]` prefix
